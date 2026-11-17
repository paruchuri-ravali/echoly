import { Hono } from "hono";
import { z } from "zod";
import { query, tx } from "../db/pool.js";
import { can, assertProject } from "../middleware/can.js";
import { body } from "../lib/validate.js";
import { audit, diff } from "../lib/audit.js";
import { notFound, forbidden, conflict } from "../lib/errors.js";
import { newId, slugify, randomToken, sha256 } from "../lib/util.js";
import { userCan } from "../middleware/can.js";
import { addMember, memberSchema } from "./users.js";

const r = new Hono();

const shape = (p) => ({
  id: p.id, org_id: p.org_id, name: p.name, slug: p.slug, description: p.description, status: p.status,
  created_at: p.created_at, limits: { daily_quota: p.daily_quota, rate_per_minute: p.rate_per_minute },
});

async function loadProject(c, id) {
  const p = (await query("SELECT * FROM projects WHERE id=$1 AND org_id=$2", [id, c.get("user").org_id])).rows[0];
  if (!p) throw notFound("Project");
  assertProject(c.get("user"), p.id);
  return p;
}

r.get("/projects", async (c) => {
  const u = c.get("user");
  const rows = (await query("SELECT * FROM projects WHERE org_id=$1 AND ($2::text[] IS NULL OR id = ANY($2)) ORDER BY created_at", [u.org_id, u.projectIds])).rows;
  return c.json(rows.map(shape));
});

r.post("/projects", can("createProject"), body(z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(500).optional() })), async (c) => {
  const u = c.get("user"); const b = c.req.valid("json");
  const slug = slugify(b.name);
  const p = await tx(async (db) => {
    if ((await db.query("SELECT 1 FROM projects WHERE org_id=$1 AND slug=$2", [u.org_id, slug])).rowCount) throw conflict("A project with that name already exists");
    const id = newId("prj");
    const row = (await db.query("INSERT INTO projects (id,org_id,name,slug,description) VALUES ($1,$2,$3,$4,$5) RETURNING *", [id, u.org_id, b.name, slug, b.description ?? ""])).rows[0];
    for (const k of ["dev", "staging", "prod"]) await db.query("INSERT INTO environments (id,project_id,kind) VALUES ($1,$2,$3)", [newId("env"), id, k]);
    return row;
  });
  await audit(c, "project.created", p.name, { project_id: p.id });
  return c.json(shape(p));
});

r.get("/projects/:id", async (c) => {
  const p = await loadProject(c, c.req.param("id"));
  const environments = (await query("SELECT id,project_id,kind FROM environments WHERE project_id=$1 ORDER BY kind", [p.id])).rows;
  const members = (await query(
    `SELECT m.user_id,u.name,u.email,m.role,m.project_id FROM memberships m JOIN users u ON u.id=m.user_id
     WHERE m.project_id=$1 OR (m.project_id IS NULL AND u.org_id=$2) ORDER BY u.name`, [p.id, p.org_id])).rows;
  return c.json({ ...shape(p), environments, members });
});

const patch = z.object({
  name: z.string().trim().min(1).max(80).optional(), description: z.string().max(500).optional(),
  status: z.enum(["active", "archived"]).optional(),
  limits: z.object({ daily_quota: z.number().int().min(0).optional(), rate_per_minute: z.number().int().min(1).optional() }).optional(),
});
r.patch("/projects/:id", can("manageProject"), body(patch), async (c) => {
  const p = await loadProject(c, c.req.param("id")); const b = c.req.valid("json");
  if (b.status && !(await userCan(c.get("user"), "createProject"))) throw forbidden("Only the main admin can archive or restore projects");
  const before = shape(p);
  const row = (await query(
    `UPDATE projects SET name=COALESCE($2,name), description=COALESCE($3,description), status=COALESCE($4,status),
       daily_quota=COALESCE($5,daily_quota), rate_per_minute=COALESCE($6,rate_per_minute) WHERE id=$1 RETURNING *`,
    [p.id, b.name, b.description, b.status, b.limits?.daily_quota, b.limits?.rate_per_minute])).rows[0];
  const after = shape(row);
  const action = b.status && b.status !== before.status ? (b.status === "archived" ? "project.archived" : "project.restored") : "project.updated";
  await audit(c, action, row.name, { project_id: p.id, changes: diff({ ...before, ...before.limits }, { ...after, ...after.limits }).filter((x) => !["limits"].includes(x.field)) });
  return c.json(after);
});

r.post("/projects/:id/members", can("manageUsers"), body(memberSchema), async (c) => {
  await loadProject(c, c.req.param("id"));
  return c.json(await addMember(c, { ...c.req.valid("json"), project_id: c.req.param("id") }));
});

// ---- API keys ----
const keyShape = (k) => ({ id: k.id, environment_id: k.environment_id, name: k.name, prefix: k.prefix, status: k.status, created_at: k.created_at, last_used_at: k.last_used_at });
const makeSecret = (kind) => { const prefix = `nan_${kind}_${randomToken(4)}`; const secret = randomToken(24); return { prefix, secret, full: `${prefix}_${secret}` }; };

r.get("/projects/:id/keys", can("viewDev"), async (c) => {
  const p = await loadProject(c, c.req.param("id"));
  const rows = (await query("SELECT k.* FROM api_keys k JOIN environments e ON e.id=k.environment_id WHERE e.project_id=$1 ORDER BY k.created_at DESC", [p.id])).rows;
  return c.json(rows.map(keyShape));
});

r.post("/projects/:id/keys", can("manageKeys"), body(z.object({ environment_id: z.string(), name: z.string().trim().min(1).max(80) })), async (c) => {
  const p = await loadProject(c, c.req.param("id")); const b = c.req.valid("json");
  const env = (await query("SELECT id,kind FROM environments WHERE id=$1 AND project_id=$2", [b.environment_id, p.id])).rows[0];
  if (!env) throw notFound("Environment");
  if (env.kind === "prod" && !(await userCan(c.get("user"), "manageProject"))) throw forbidden("Production keys need the Manage project settings permission");
  const s = makeSecret(env.kind);
  const k = (await query("INSERT INTO api_keys (id,environment_id,name,prefix,secret_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *", [newId("key"), env.id, b.name, s.prefix, sha256(s.secret)])).rows[0];
  await audit(c, "api_key.created", `${k.name} (${env.kind})`, { project_id: p.id });
  return c.json({ ...keyShape(k), secret: s.full }); // shown exactly once
});

r.post("/keys/:id/:action{rotate|revoke}", can("manageKeys"), async (c) => {
  const k = (await query("SELECT k.*, e.project_id, e.kind FROM api_keys k JOIN environments e ON e.id=k.environment_id WHERE k.id=$1", [c.req.param("id")])).rows[0];
  if (!k) throw notFound("Key");
  await loadProject(c, k.project_id); // project isolation
  if (k.kind === "prod" && !(await userCan(c.get("user"), "manageProject"))) throw forbidden("Production keys need the Manage project settings permission");
  if (c.req.param("action") === "revoke") {
    const row = (await query("UPDATE api_keys SET status='revoked' WHERE id=$1 RETURNING *", [k.id])).rows[0];
    await audit(c, "api_key.revoked", k.name, { project_id: k.project_id, changes: [{ field: "status", from: k.status, to: "revoked" }] });
    return c.json(keyShape(row));
  }
  const s = makeSecret(k.kind);
  const row = (await query("UPDATE api_keys SET status='rotating', prefix=$2, secret_hash=$3 WHERE id=$1 RETURNING *", [k.id, s.prefix, sha256(s.secret)])).rows[0];
  await audit(c, "api_key.rotated", k.name, { project_id: k.project_id });
  return c.json({ ...keyShape(row), secret: s.full });
});

export default r;

import { Hono } from "hono";
import { z } from "zod";
import { query } from "../db/pool.js";
import { can } from "../middleware/can.js";
import { body } from "../lib/validate.js";
import { audit } from "../lib/audit.js";
import { forbidden, notFound, conflict } from "../lib/errors.js";
import { newId, normEmail } from "../lib/util.js";

const r = new Hono();

/** Roles the signed-in user may hand out: the main admin any non-admin; others only below their own. */
const grantable = (user) => (user.role === "org_admin" ? ["project_admin", "developer", "client"] : ["developer", "client"]);

export const memberSchema = z.object({
  name: z.string().trim().min(1).max(80), email: z.string().email(),
  role: z.enum(["project_admin", "developer", "client"]),
});

export async function addMember(c, b) {
  const u = c.get("user");
  if (!grantable(u).includes(b.role)) throw forbidden("You can only assign roles below your own");
  if (u.projectIds && !u.projectIds.includes(b.project_id)) throw forbidden("You can only add users to your own projects");
  const proj = (await query("SELECT id FROM projects WHERE id=$1 AND org_id=$2", [b.project_id, u.org_id])).rows[0];
  if (!proj) throw notFound("Project");
  const email = normEmail(b.email);
  let user = (await query("SELECT id,name,org_id FROM users WHERE email=$1", [email])).rows[0];
  if (user && user.org_id !== u.org_id) throw conflict("That email belongs to another organization");
  if (!user) user = (await query("INSERT INTO users (id,org_id,email,name) VALUES ($1,$2,$3,$4) RETURNING id,name", [newId("usr"), u.org_id, email, b.name])).rows[0];
  const dup = await query("SELECT 1 FROM memberships WHERE user_id=$1 AND project_id=$2", [user.id, b.project_id]);
  if (dup.rowCount) throw conflict("That user already has access to this project");
  await query("INSERT INTO memberships (id,user_id,project_id,role) VALUES ($1,$2,$3,$4)", [newId("mem"), user.id, b.project_id, b.role]);
  await audit(c, "user.invited", `${user.name} <${email}>`, { project_id: b.project_id, changes: [{ field: "role", from: "", to: b.role }] });
  return { user_id: user.id, name: user.name, email, role: b.role, project_id: b.project_id };
}

r.get("/users", async (c) => {
  const u = c.get("user");
  const rows = (await query(
    `SELECT m.user_id,us.name,us.email,m.role,m.project_id FROM memberships m JOIN users us ON us.id=m.user_id
     WHERE us.org_id=$1 AND ($2::text[] IS NULL OR m.project_id = ANY($2)) ORDER BY us.name`, [u.org_id, u.projectIds])).rows;
  return c.json(rows);
});

r.post("/users", can("manageUsers", "Your role cannot invite users"), body(memberSchema.extend({ project_id: z.string() })), async (c) =>
  c.json(await addMember(c, c.req.valid("json"))));

r.patch("/users/:id", can("manageUsers", "Your role cannot change user roles"),
  body(z.object({ role: z.enum(["project_admin", "developer", "client"]), project_id: z.string().optional() })), async (c) => {
    const u = c.get("user"); const b = c.req.valid("json");
    if (!grantable(u).includes(b.role)) throw forbidden("You can only assign roles below your own");
    const rows = (await query(
      `SELECT m.id,m.role,m.project_id,us.email FROM memberships m JOIN users us ON us.id=m.user_id
       WHERE m.user_id=$1 AND us.org_id=$2 AND m.project_id IS NOT NULL AND ($3::text IS NULL OR m.project_id=$3)`,
      [c.req.param("id"), u.org_id, b.project_id ?? null])).rows;
    if (!rows.length) throw notFound("User");
    if (rows.length > 1) throw conflict("User has several project memberships; pass project_id");
    const m = rows[0];
    if (u.projectIds && (!u.projectIds.includes(m.project_id) || ["project_admin", "org_admin"].includes(m.role)))
      throw forbidden("You can only change developers and clients in your own projects");
    await query("UPDATE memberships SET role=$2 WHERE id=$1", [m.id, b.role]);
    await audit(c, "user.role_changed", m.email, { project_id: m.project_id, changes: [{ field: "role", from: m.role, to: b.role }] });
    const us = (await query("SELECT name FROM users WHERE id=$1", [c.req.param("id")])).rows[0];
    return c.json({ user_id: c.req.param("id"), name: us.name, email: m.email, role: b.role, project_id: m.project_id });
  });

export default r;

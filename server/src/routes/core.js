import { Hono } from "hono";
import { z } from "zod";
import { query } from "../db/pool.js";
import { can, loadMatrix } from "../middleware/can.js";
import { body } from "../lib/validate.js";
import { audit } from "../lib/audit.js";
import { DEFAULT_MATRIX, LOCKED, PERM_LABELS, ROLE_LABEL, ROLES } from "../lib/perms.js";

const r = new Hono();

r.get("/me", (c) => {
  const { id, email, name, role, org_id } = c.get("user");
  return c.json({ id, email, name, role, org_id });
});

r.get("/orgs", async (c) => c.json((await query("SELECT id,name,slug FROM orgs WHERE id=$1", [c.get("user").org_id])).rows));

r.get("/permissions", async (c) => c.json({ matrix: await loadMatrix(c.get("user").org_id) }));

const putPerms = z.object({ matrix: z.record(z.array(z.enum(ROLES))) });
r.put("/permissions", can("manageRoles", "Only the main admin can change permissions"), body(putPerms), async (c) => {
  const u = c.get("user");
  const current = await loadMatrix(u.org_id);
  const next = { ...current };
  const changes = [];
  for (const key of Object.keys(DEFAULT_MATRIX)) {
    if (LOCKED.has(key) || !c.req.valid("json").matrix[key]) continue;
    const want = [...new Set(["org_admin", ...c.req.valid("json").matrix[key]])];
    if (JSON.stringify([...want].sort()) !== JSON.stringify([...current[key]].sort())) {
      changes.push({ field: PERM_LABELS[key], from: current[key].map((x) => ROLE_LABEL[x]).join(", "), to: want.map((x) => ROLE_LABEL[x]).join(", ") });
      next[key] = want;
    }
  }
  await query("INSERT INTO org_settings (org_id,key,value) VALUES ($1,'permissions',$2) ON CONFLICT (org_id,key) DO UPDATE SET value=$2", [u.org_id, JSON.stringify(next)]);
  if (changes.length) await audit(c, "permissions.updated", `${changes.length} permission${changes.length > 1 ? "s" : ""}`, { changes });
  return c.json({ matrix: next });
});

r.post("/permissions/reset", can("manageRoles", "Only the main admin can change permissions"), async (c) => {
  await query("DELETE FROM org_settings WHERE org_id=$1 AND key='permissions'", [c.get("user").org_id]);
  await audit(c, "permissions.reset", "defaults restored");
  return c.json({ matrix: DEFAULT_MATRIX });
});

export default r;

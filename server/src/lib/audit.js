import { query } from "../db/pool.js";
import { newId } from "./util.js";

/** Writes an audit row. `c` is the Hono context of the signed-in actor. */
export async function audit(c, action, target, { project_id, changes } = {}) {
  const u = c.get("user");
  let project_name = null;
  if (project_id) project_name = (await query("SELECT name FROM projects WHERE id=$1", [project_id])).rows[0]?.name ?? null;
  const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "";
  await query(
    `INSERT INTO audit_logs (id,org_id,actor,actor_name,actor_role,action,target,project_id,project_name,ip,changes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [newId("aud"), u.org_id, u.email, u.name, u.role, action, target, project_id ?? null, project_name, ip, changes ? JSON.stringify(changes) : null],
  );
}

export const diff = (before, after) =>
  Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ field: k, from: String(JSON.stringify(before[k]) ?? ""), to: String(JSON.stringify(after[k]) ?? "") }));

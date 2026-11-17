import { Hono } from "hono";
import { query } from "../db/pool.js";
import { can } from "../middleware/can.js";
import { pageParams, pageResult } from "../lib/util.js";

const r = new Hono();

r.get("/audit-logs", can("viewAudit", "Your role cannot view the audit log"), async (c) => {
  const u = c.get("user"); const q = c.req.query(); const pg = pageParams(q);
  const where = ["org_id=$1", "($2::text[] IS NULL OR project_id = ANY($2))"];
  const args = [u.org_id, u.projectIds];
  const add = (sql, v) => { args.push(v); where.push(sql.replaceAll("?", `$${args.length}`)); };
  if (q.category) add("action LIKE ?", `${q.category}.%`);
  if (q.actor) add("actor = ?", q.actor);
  if (q.project) add("project_id = ?", q.project);
  if (q.from) add("at >= ?", q.from);
  if (q.to) add("at < (?::date + 1)", q.to);
  if (q.q) add("(actor ILIKE ? OR actor_name ILIKE ? OR action ILIKE ? OR target ILIKE ? OR COALESCE(project_name,'') ILIKE ?)", `%${q.q}%`);
  const sql = where.join(" AND ");
  const total = (await query(`SELECT count(*)::int n FROM audit_logs WHERE ${sql}`, args)).rows[0].n;
  const rows = (await query(`SELECT id,at,actor,actor_name,actor_role,action,target,project_id,project_name,ip,changes FROM audit_logs WHERE ${sql} ORDER BY at DESC LIMIT ${pg.limit} OFFSET ${pg.offset}`, args)).rows;
  return c.json(pageResult(rows, total, pg));
});

export default r;

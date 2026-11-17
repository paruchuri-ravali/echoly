import { getCookie } from "hono/cookie";
import { query } from "../db/pool.js";
import { HttpError } from "../lib/errors.js";
import { sha256 } from "../lib/util.js";
import { ROLE_RANK } from "../lib/perms.js";

export const COOKIE = "sid";

/** Loads the signed-in user + memberships. Sets c.var.user = { id,email,name,org_id,role,projectIds|null }. */
export const session = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) throw new HttpError(401, "unauthorized", "Not signed in");
  const { rows } = await query(
    `SELECT u.id,u.email,u.name,u.org_id FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>now()`, [sha256(token)]);
  const u = rows[0];
  if (!u) throw new HttpError(401, "unauthorized", "Session expired");
  const mem = (await query("SELECT project_id, role FROM memberships WHERE user_id=$1", [u.id])).rows;
  if (!mem.length) throw new HttpError(403, "forbidden", "No access assigned to this account");
  const role = mem.map((m) => m.role).sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0];
  const orgWide = mem.some((m) => m.project_id === null);
  c.set("user", { ...u, role, projectIds: orgWide ? null : mem.map((m) => m.project_id) });
  await next();
};

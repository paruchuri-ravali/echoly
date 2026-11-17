import { query } from "../db/pool.js";
import { session } from "./session.js";
import { sha256 } from "../lib/util.js";
import { HttpError } from "../lib/errors.js";

/** /v1/*: accepts either `Authorization: Bearer <api key>` (server-to-server) or the dashboard session cookie. */
export const v1auth = async (c, next) => {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return session(c, next);
  const tok = h.slice(7).trim();
  const k = (await query(
    `SELECT k.id,k.name,k.prefix,k.secret_hash,k.status,e.kind,e.project_id,p.org_id,p.status AS pstatus
     FROM api_keys k JOIN environments e ON e.id=k.environment_id JOIN projects p ON p.id=e.project_id
     WHERE $1 LIKE k.prefix || '_%'`, [tok])).rows[0];
  const bad = new HttpError(401, "unauthorized", "Invalid API key");
  if (!k || k.status === "revoked" || k.pstatus !== "active") throw bad;
  if (k.secret_hash !== sha256(tok.slice(k.prefix.length + 1))) throw bad;
  query("UPDATE api_keys SET last_used_at=now() WHERE id=$1", [k.id]).catch(() => {});
  c.set("user", { id: k.id, email: `api-key:${k.prefix}`, name: k.name, org_id: k.org_id, role: "developer", projectIds: [k.project_id], apiKeyEnv: k.kind });
  await next();
};

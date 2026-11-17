import { query } from "../db/pool.js";
import { DEFAULT_MATRIX } from "../lib/perms.js";
import { forbidden } from "../lib/errors.js";

export async function loadMatrix(org_id) {
  const r = (await query("SELECT value FROM org_settings WHERE org_id=$1 AND key='permissions'", [org_id])).rows[0];
  return { ...DEFAULT_MATRIX, ...(r?.value ?? {}) };
}

/** True if the user's role holds the permission. org_admin can never be locked out. */
export async function userCan(user, perm) {
  if (user.role === "org_admin") return true;
  return (await loadMatrix(user.org_id))[perm]?.includes(user.role) ?? false;
}

export const can = (perm, msg) => async (c, next) => {
  if (!(await userCan(c.get("user"), perm))) throw forbidden(msg);
  await next();
};

/** Project isolation: throws unless the user may access this project. */
export function assertProject(user, projectId) {
  if (user.projectIds && !user.projectIds.includes(projectId)) throw forbidden("You do not have access to this project");
}

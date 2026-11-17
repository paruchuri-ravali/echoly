// Keep in sync with web/src/lib/permissions.ts. The server is the source of truth for enforcement.
const ADMIN = ["org_admin"];
const MGR = ["org_admin", "project_admin"];
const STAFF = ["org_admin", "project_admin", "developer"];
const ALL = ["org_admin", "project_admin", "developer", "client"];

export const DEFAULT_MATRIX = {
  manageRoles: ADMIN, manageUsers: MGR, createProject: ADMIN, viewAdmin: MGR, manageProject: MGR,
  manageKeys: STAFF, writeProviders: MGR, editBranding: ALL, viewDev: STAFF, editTemplates: STAFF,
  operate: STAFF, viewWorkflows: STAFF, viewSchedules: STAFF, viewChannels: STAFF, viewLogs: STAFF,
  revealRecipients: MGR, viewAudit: MGR,
};
export const PERM_LABELS = {
  manageRoles: "Manage users, roles and permissions", manageUsers: "Invite users and assign roles (below their own)",
  createProject: "Create / archive projects", viewAdmin: "Open Security & admin",
  manageProject: "Manage project settings, members and quotas", manageKeys: "Create / rotate API keys",
  writeProviders: "Write provider credentials", editBranding: "Customize email branding",
  viewDev: "Open Projects and Developer portal", editTemplates: "Edit templates",
  operate: "Send, retry and cancel notifications", viewWorkflows: "View workflows", viewSchedules: "View schedules",
  viewChannels: "View channel and provider status", viewLogs: "View logs and monitoring",
  revealRecipients: "Reveal unmasked recipients (audited)", viewAudit: "View audit log",
};
export const LOCKED = new Set(["manageRoles"]);
export const ROLES = ["org_admin", "project_admin", "developer", "client", "viewer"];
export const ROLE_LABEL = { org_admin: "Main admin", project_admin: "Manager", developer: "Developer", client: "Client", viewer: "Viewer" };
/** Higher index = more privileged. */
export const ROLE_RANK = { viewer: 0, client: 1, developer: 2, project_admin: 3, org_admin: 4 };

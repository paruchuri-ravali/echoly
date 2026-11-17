import { Hono } from "hono";
import { z } from "zod";
import { query } from "../db/pool.js";
import { can, assertProject } from "../middleware/can.js";
import { body } from "../lib/validate.js";
import { audit } from "../lib/audit.js";
import { HttpError, notFound, conflict, invalid } from "../lib/errors.js";
import { newId, pageParams, pageResult } from "../lib/util.js";
import { renderContent, varsOf } from "../lib/render.js";
import { gallery } from "../lib/catalog.js";
import { deliver, findTemplate } from "../services/deliver.js";

const r = new Hono();
export const internal = new Hono();

// ---------------- notifications ----------------
const mask = (v, ch) => (ch === "email" ? v.replace(/^(.).*@/, "$1***@") : `+** *** **${v.slice(-2)}`);
const listShape = (n) => ({
  id: n.id, project_id: n.project_id, environment_id: n.environment_id, env: n.env, category: n.category, priority: n.priority,
  status: n.status, channels: n.channels, recipient: n.recipient, template_key: n.template_key, created_at: n.created_at,
  send_at: n.send_at, idempotency_key: n.idempotency_key,
});
const detailShape = (n) => ({
  ...listShape(n), deliveries: n.deliveries, timeline: [{ type: "accepted", at: n.created_at }, { type: "queued", at: n.created_at }, ...n.timeline],
  webhook_events: [], retryable: n.status === "failed", cancellable: n.cancellable && ["queued", "scheduled"].includes(n.status),
});

/** Shared filter builder for notification queries (also used by overview/analytics). */
export function notifFilter(user, q, alias = "n") {
  const args = [user.org_id, user.projectIds];
  const w = [`${alias}.org_id=$1`, `($2::text[] IS NULL OR ${alias}.project_id = ANY($2))`];
  const add = (sql, v) => { args.push(v); w.push(sql.replaceAll("?", `$${args.length}`)); };
  if (q.project) add(`${alias}.project_id = ?`, q.project);
  if (q.env) add(`${alias}.env = ?`, q.env);
  if (q.channel) add(`${alias}.channels ? ?`, q.channel);
  if (q.status) add(`${alias}.status = ?`, q.status);
  if (q.category) add(`${alias}.category = ?`, q.category);
  if (q.from) add(`${alias}.created_at >= ?::date`, q.from);
  if (q.to) add(`${alias}.created_at < (?::date + 1)`, q.to);
  if (q.q) add(`(${alias}.id ILIKE ? OR ${alias}.recipient ILIKE ?)`, `%${q.q}%`);
  return { where: w.join(" AND "), args };
}

r.get("/notifications", async (c) => {
  const q = c.req.query(); const pg = pageParams(q); const f = notifFilter(c.get("user"), q);
  const total = (await query(`SELECT count(*)::int n FROM notifications n WHERE ${f.where}`, f.args)).rows[0].n;
  const rows = (await query(`SELECT * FROM notifications n WHERE ${f.where} ORDER BY n.created_at DESC LIMIT ${pg.limit} OFFSET ${pg.offset}`, f.args)).rows;
  return c.json(pageResult(rows.map(listShape), total, pg));
});

const createSchema = z.object({
  template: z.object({ key: z.string().min(1) }),
  to: z.object({ email: z.string().email().optional(), phone: z.string().min(5).optional() }),
  channels: z.array(z.enum(["email", "sms", "whatsapp", "push", "in_app"])).min(1).optional(),
  data: z.record(z.any()).optional(), environment: z.enum(["dev", "staging", "prod"]).optional(),
  project_id: z.string().optional(), send_at: z.string().datetime().optional(), category: z.string().optional(), priority: z.enum(["critical", "high", "normal", "low"]).optional(),
});

export async function createNotification(c, b) {
  const u = c.get("user");
  const channel = b.channels?.[0] ?? "email";
  const raw = channel === "email" ? b.to.email : b.to.phone;
  if (!raw) throw invalid(channel === "email" ? "to.email is required" : "to.phone is required");
  let project_id = b.project_id ?? u.projectIds?.[0];
  if (!project_id) project_id = (await query("SELECT id FROM projects WHERE org_id=$1 AND status='active' ORDER BY created_at LIMIT 1", [u.org_id])).rows[0]?.id;
  if (!project_id) throw invalid("Create a project first");
  assertProject(u, project_id);
  const proj = (await query("SELECT id FROM projects WHERE id=$1 AND org_id=$2", [project_id, u.org_id])).rows[0];
  if (!proj) throw notFound("Project");
  const env = u.apiKeyEnv ?? b.environment ?? "dev";
  const envRow = (await query("SELECT id FROM environments WHERE project_id=$1 AND kind=$2", [project_id, env])).rows[0];
  const idem = c.req.header("idempotency-key") ?? null;
  if (idem) {
    const ex = (await query("SELECT id,status FROM notifications WHERE project_id=$1 AND idempotency_key=$2", [project_id, idem])).rows[0];
    if (ex) return { id: ex.id, status: ex.status };
  }
  if (!(await findTemplate(u.org_id, project_id, b.template.key))) throw notFound(`Template "${b.template.key}"`);
  const future = b.send_at && Date.parse(b.send_at) > Date.now() + 5000;
  const id = newId("ntf");
  const status = future ? "scheduled" : "queued";
  await query(
    `INSERT INTO notifications (id,org_id,project_id,env,environment_id,category,priority,status,channels,recipient,recipient_raw,template_key,data,idempotency_key,send_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [id, u.org_id, project_id, env, envRow.id, b.category ?? "transactional", b.priority ?? "normal", status, JSON.stringify([channel]),
      mask(raw, channel), raw, b.template.key, JSON.stringify(b.data ?? {}), idem, future ? b.send_at : null]);
  if (!future) setImmediate(() => deliver(id).catch((e) => console.error("deliver failed", id, e)));
  return { id, status };
}

r.post("/notifications", can("operate", "Your role cannot send notifications"), body(createSchema), async (c) =>
  c.json(await createNotification(c, c.req.valid("json")), 202));

async function loadNotif(c, id) {
  const u = c.get("user");
  const n = (await query("SELECT * FROM notifications WHERE id=$1 AND org_id=$2", [id, u.org_id])).rows[0];
  if (!n) throw notFound("Notification");
  assertProject(u, n.project_id);
  return n;
}
r.get("/notifications/:id", async (c) => c.json(detailShape(await loadNotif(c, c.req.param("id")))));
r.post("/notifications/:id/retry", can("operate"), async (c) => {
  const n = await loadNotif(c, c.req.param("id"));
  if (n.status !== "failed") throw new HttpError(409, "not_retryable", "Only failed notifications can be retried");
  await query("UPDATE notifications SET status='queued', cancellable=true WHERE id=$1", [n.id]);
  await deliver(n.id);
  return c.json(detailShape(await loadNotif(c, n.id)));
});
r.post("/notifications/:id/cancel", can("operate"), async (c) => {
  const n = await loadNotif(c, c.req.param("id"));
  if (!["queued", "scheduled"].includes(n.status) || !n.cancellable) throw new HttpError(409, "not_cancellable", "Notification can no longer be cancelled");
  await query("UPDATE notifications SET status='cancelled', cancellable=false, timeline = timeline || $2::jsonb WHERE id=$1", [n.id, JSON.stringify([{ type: "cancelled", at: new Date().toISOString() }])]);
  return c.json(detailShape(await loadNotif(c, n.id)));
});

// ---------------- templates ----------------
const tplShape = (t, withVersions = false) => ({
  id: t.id, key: t.key, name: t.name, scope: t.scope, project_id: t.project_id, status: t.status, channels: t.channels,
  latest_version: t.latest_version, updated_at: t.updated_at, sample_data: t.sample_data, ...(withVersions ? { versions: t.versions } : {}),
});
const visibleTpl = (u) => ({ sql: "org_id=$1 AND ($2::text[] IS NULL OR project_id IS NULL OR project_id = ANY($2))", args: [u.org_id, u.projectIds] });
async function loadTpl(c, id) {
  const u = c.get("user"); const v = visibleTpl(u);
  const t = (await query(`SELECT * FROM templates WHERE id=$3 AND ${v.sql}`, [...v.args, id])).rows[0];
  if (!t) throw notFound("Template");
  return t;
}
async function defaultProject(c, requested) {
  const u = c.get("user");
  const id = requested ?? u.projectIds?.[0] ?? (await query("SELECT id FROM projects WHERE org_id=$1 AND status='active' ORDER BY created_at LIMIT 1", [u.org_id])).rows[0]?.id;
  if (!id) throw invalid("Create a project first");
  assertProject(u, id);
  return id;
}
const newVersion = (content, author, status = "published") => ({ version: 1, status, created_at: new Date().toISOString(), author, content, variables: varsOf(content) });
const insertTpl = async (t) => (await query(
  `INSERT INTO templates (id,org_id,key,name,scope,project_id,status,channels,latest_version,sample_data,versions)
   VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10) RETURNING *`,
  [t.id, t.org_id, t.key, t.name, t.scope, t.project_id, JSON.stringify(t.channels), t.latest_version, JSON.stringify(t.sample_data), JSON.stringify(t.versions)])).rows[0];
const dupKey = (e) => (e.code === "23505" ? conflict("A template with that key already exists") : e);

r.get("/templates", async (c) => {
  const u = c.get("user"); const q = c.req.query(); const pg = pageParams(q); const v = visibleTpl(u);
  const args = [...v.args]; let w = v.sql;
  if (q.status) { args.push(q.status); w += ` AND status=$${args.length}`; }
  if (q.q) { args.push(`%${q.q}%`); w += ` AND (key ILIKE $${args.length} OR name ILIKE $${args.length})`; }
  const total = (await query(`SELECT count(*)::int n FROM templates WHERE ${w}`, args)).rows[0].n;
  const rows = (await query(`SELECT * FROM templates WHERE ${w} ORDER BY updated_at DESC LIMIT ${pg.limit} OFFSET ${pg.offset}`, args)).rows;
  return c.json(pageResult(rows.map((t) => tplShape(t)), total, pg));
});
r.get("/template-gallery", (c) => c.json(gallery));
r.post("/templates/preview", body(z.object({ content: z.record(z.any()), data: z.record(z.any()).optional() })), (c) => {
  const b = c.req.valid("json"); return c.json(renderContent(b.content, b.data));
});
r.post("/templates/from-gallery", can("editTemplates"), body(z.object({ gallery_id: z.string(), key: z.string().min(1), name: z.string().min(1), project_id: z.string().optional() })), async (c) => {
  const b = c.req.valid("json"); const u = c.get("user");
  const it = gallery.find((g) => g.id === b.gallery_id); if (!it) throw notFound("Gallery template");
  const pid = await defaultProject(c, b.project_id);
  try {
    const t = await insertTpl({ id: newId("tpl"), org_id: u.org_id, key: b.key, name: b.name, scope: "project", project_id: pid, channels: Object.keys(it.content), latest_version: 1, sample_data: it.sample_data, versions: [newVersion(it.content, u.name)] });
    await audit(c, "template.created", `${t.name} (from gallery)`, { project_id: pid });
    return c.json(tplShape(t, true));
  } catch (e) { throw dupKey(e); }
});
r.post("/templates", can("editTemplates"), body(z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9-_]*$/, "lowercase letters, numbers, - and _"), name: z.string().min(1), scope: z.enum(["project", "organization"]).optional(), project_id: z.string().optional() })), async (c) => {
  const b = c.req.valid("json"); const u = c.get("user");
  const org = b.scope === "organization";
  if (org && u.role !== "org_admin") throw new HttpError(403, "forbidden", "Only the main admin can create organization-wide templates");
  const pid = org ? null : await defaultProject(c, b.project_id);
  const content = { email: { subject: b.name, body: "<p>Hello {{name}}</p>" } };
  try {
    const t = await insertTpl({ id: newId("tpl"), org_id: u.org_id, key: b.key, name: b.name, scope: org ? "organization" : "project", project_id: pid, channels: ["email"], latest_version: 1, sample_data: { name: "Alex" }, versions: [newVersion(content, u.name, "draft")] });
    await audit(c, "template.created", t.name, { project_id: pid ?? undefined });
    return c.json(tplShape(t, true));
  } catch (e) { throw dupKey(e); }
});
r.get("/templates/:id", async (c) => c.json(tplShape(await loadTpl(c, c.req.param("id")), true)));
r.patch("/templates/:id", can("editTemplates"), body(z.object({ name: z.string().min(1).optional(), status: z.enum(["active", "archived"]).optional(), sample_data: z.record(z.any()).optional() })), async (c) => {
  const t = await loadTpl(c, c.req.param("id")); const b = c.req.valid("json");
  const row = (await query("UPDATE templates SET name=COALESCE($2,name), status=COALESCE($3,status), sample_data=COALESCE($4,sample_data), updated_at=now() WHERE id=$1 RETURNING *", [t.id, b.name, b.status, b.sample_data ? JSON.stringify(b.sample_data) : null])).rows[0];
  await audit(c, "template.updated", row.name, { project_id: row.project_id ?? undefined });
  return c.json(tplShape(row, true));
});
r.post("/templates/:id/versions", can("editTemplates"), body(z.object({ content: z.record(z.any()) })), async (c) => {
  const t = await loadTpl(c, c.req.param("id")); const u = c.get("user"); const b = c.req.valid("json");
  const v = { ...newVersion(b.content, u.name), version: t.latest_version + 1 };
  const row = (await query("UPDATE templates SET versions = versions || $2::jsonb, latest_version=$3, channels=$4, updated_at=now() WHERE id=$1 RETURNING *", [t.id, JSON.stringify([v]), v.version, JSON.stringify(Object.keys(b.content))])).rows[0];
  await audit(c, "template.published", `${t.key} v${v.version}`, { project_id: t.project_id ?? undefined });
  return c.json(tplShape(row, true));
});
r.post("/templates/:id/duplicate", can("editTemplates"), body(z.object({ key: z.string().min(1), name: z.string().min(1) })), async (c) => {
  const src = await loadTpl(c, c.req.param("id")); const b = c.req.valid("json"); const u = c.get("user");
  const last = src.versions[src.versions.length - 1];
  try {
    const t = await insertTpl({ id: newId("tpl"), org_id: u.org_id, key: b.key, name: b.name, scope: src.scope, project_id: src.project_id, channels: src.channels, latest_version: 1, sample_data: src.sample_data, versions: [{ ...last, version: 1, created_at: new Date().toISOString(), author: u.name }] });
    await audit(c, "template.duplicated", `${src.name} → ${t.name}`, { project_id: t.project_id ?? undefined });
    return c.json(tplShape(t, true));
  } catch (e) { throw dupKey(e); }
});
r.post("/templates/:id/override", can("editTemplates"), body(z.object({ project_id: z.string() })), async (c) => {
  const src = await loadTpl(c, c.req.param("id")); const b = c.req.valid("json"); const u = c.get("user");
  assertProject(u, b.project_id);
  const proj = (await query("SELECT id,name FROM projects WHERE id=$1 AND org_id=$2", [b.project_id, u.org_id])).rows[0];
  if (!proj) throw notFound("Project");
  const last = src.versions[src.versions.length - 1];
  try {
    const t = await insertTpl({ id: newId("tpl"), org_id: u.org_id, key: src.key, name: `${src.name} (${proj.name})`, scope: "project", project_id: proj.id, channels: src.channels, latest_version: 1, sample_data: src.sample_data, versions: [{ ...last, version: 1, created_at: new Date().toISOString(), author: u.name }] });
    await audit(c, "template.customized", t.name, { project_id: proj.id });
    return c.json(tplShape(t, true));
  } catch (e) { throw e.code === "23505" ? conflict(`${proj.name} already has its own copy`) : e; }
});
r.get("/templates/:id/usage", async (c) => {
  const t = await loadTpl(c, c.req.param("id")); const u = c.get("user");
  const projects = (await query("SELECT id,name FROM projects WHERE org_id=$1 AND status='active' AND ($2::text[] IS NULL OR id = ANY($2)) ORDER BY name", [u.org_id, u.projectIds])).rows;
  const ovr = (await query("SELECT id,project_id FROM templates WHERE org_id=$1 AND key=$2 AND project_id IS NOT NULL AND id<>$3", [u.org_id, t.key, t.id])).rows;
  const brands = Object.fromEntries((await query("SELECT project_id,data FROM brandings WHERE project_id = ANY($1)", [projects.map((p) => p.id)])).rows.map((x) => [x.project_id, x.data]));
  return c.json(projects.map((p) => {
    const ov = ovr.find((o) => o.project_id === p.id); const br = brands[p.id] ?? {};
    return { project_id: p.id, project_name: p.name, brand_color: br.brand_color ?? "#4f46e5", accent_color: br.accent_color ?? "#0e9f8e", sender_name: br.sender_name || p.name, source: ov ? "override" : "inherited", override_id: ov?.id ?? null };
  }));
});
r.post("/templates/:id/:action{preview|test}", body(z.object({ content: z.record(z.any()).optional(), data: z.record(z.any()).optional(), to: z.any().optional(), channel: z.string().optional() })), async (c) => {
  const t = await loadTpl(c, c.req.param("id")); const b = c.req.valid("json");
  if (c.req.param("action") === "preview") return c.json(renderContent(b.content ?? t.versions[t.versions.length - 1].content, b.data ?? t.sample_data));
  if (!(await import("../middleware/can.js").then((m) => m.userCan(c.get("user"), "operate")))) throw new HttpError(403, "forbidden", "Your role cannot send test messages");
  const ch = b.channel ?? "email";
  const to = typeof b.to === "string" ? (ch === "email" ? { email: b.to } : { phone: b.to }) : (b.to ?? {});
  return c.json(await createNotification(c, { template: { key: t.key }, to, channels: [ch], data: b.data ?? t.sample_data, project_id: t.project_id ?? undefined, category: "transactional" }));
});

// ---------------- schedules ----------------
function tzOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}
const zonedToUtc = (local, tz) => { const guess = Date.parse(`${local}${local.length === 16 ? ":00" : ""}Z`); return new Date(guess - tzOffsetMs(guess, tz)); };
const schShape = (s) => ({ id: s.id, template_key: s.template_key, recipient: s.recipient, channel: s.channel, timezone: s.timezone, kind: s.kind, rule: s.rule, next_run_at: s.next_run_at, status: s.status, last_run_status: s.last_run_status });

r.get("/schedules", can("viewSchedules"), async (c) => {
  const u = c.get("user");
  const rows = (await query("SELECT * FROM schedules WHERE org_id=$1 AND ($2::text[] IS NULL OR project_id IS NULL OR project_id = ANY($2)) ORDER BY created_at DESC", [u.org_id, u.projectIds])).rows;
  return c.json(rows.map(schShape));
});
r.post("/schedules", can("operate"), body(z.object({ template_key: z.string(), recipient: z.string().min(3), channel: z.enum(["email", "whatsapp"]).default("email"), timezone: z.string(), local_time: z.string(), project_id: z.string().optional() })), async (c) => {
  const b = c.req.valid("json"); const u = c.get("user"); const pid = await defaultProject(c, b.project_id);
  let when; try { when = zonedToUtc(b.local_time, b.timezone); if (Number.isNaN(when.getTime())) throw new Error(); } catch { throw invalid("Invalid date/time or timezone"); }
  if (when.getTime() < Date.now() + 30000) throw invalid("Choose a time in the future");
  if (!(await findTemplate(u.org_id, pid, b.template_key))) throw notFound(`Template "${b.template_key}"`);
  const row = (await query("INSERT INTO schedules (id,org_id,project_id,template_key,recipient,channel,timezone,next_run_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [newId("sch"), u.org_id, pid, b.template_key, b.recipient, b.channel, b.timezone, when.toISOString()])).rows[0];
  await audit(c, "schedule.created", `${b.template_key} → ${b.recipient}`, { project_id: pid });
  return c.json(schShape(row));
});
r.post("/schedules/:id/cancel", can("operate"), async (c) => {
  const u = c.get("user");
  const s = (await query("SELECT * FROM schedules WHERE id=$1 AND org_id=$2", [c.req.param("id"), u.org_id])).rows[0];
  if (!s) throw notFound("Schedule");
  if (s.project_id) assertProject(u, s.project_id);
  if (s.status !== "scheduled") throw new HttpError(409, "not_cancellable", "Schedule can no longer be cancelled");
  return c.json(schShape((await query("UPDATE schedules SET status='cancelled', next_run_at=NULL WHERE id=$1 RETURNING *", [s.id])).rows[0]));
});

/** Fires due one-off schedules. Called by a timer in server.js (single instance). */
export async function runDueSchedules() {
  const due = (await query("SELECT * FROM schedules WHERE status='scheduled' AND next_run_at <= now() LIMIT 20")).rows;
  for (const s of due) {
    const claimed = await query("UPDATE schedules SET status='running' WHERE id=$1 AND status='scheduled' RETURNING id", [s.id]);
    if (!claimed.rowCount) continue;
    try {
      const fakeCtx = { get: () => ({ org_id: s.org_id, projectIds: s.project_id ? [s.project_id] : null }), req: { header: () => `sched-${s.id}` } };
      await createNotification(fakeCtx, { template: { key: s.template_key }, to: s.channel === "email" ? { email: s.recipient } : { phone: s.recipient }, channels: [s.channel], project_id: s.project_id ?? undefined, category: "scheduled" });
      await query("UPDATE schedules SET status='completed', last_run_status='ok', next_run_at=NULL WHERE id=$1", [s.id]);
    } catch (e) {
      console.error("schedule failed", s.id, e.message);
      await query("UPDATE schedules SET status='failed', last_run_status='failed', next_run_at=NULL WHERE id=$1", [s.id]);
    }
  }
}

// ---------------- workflows & webhooks ----------------
const wfShape = (w) => ({ id: w.id, name: w.name, trigger_event: w.trigger_event, active: w.active, category: w.category, conditions: w.conditions, steps: w.steps, version: w.version, updated_at: w.updated_at });
internal.get("/workflows", can("viewWorkflows"), async (c) => c.json((await query("SELECT * FROM workflows WHERE org_id=$1 ORDER BY updated_at DESC", [c.get("user").org_id])).rows.map(wfShape)));
internal.patch("/workflows/:id", can("editTemplates"), body(z.object({ active: z.boolean().optional() })), async (c) => {
  const b = c.req.valid("json");
  const w = (await query("UPDATE workflows SET active=COALESCE($3,active), updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *", [c.req.param("id"), c.get("user").org_id, b.active])).rows[0];
  if (!w) throw notFound("Workflow");
  await audit(c, "workflow.updated", w.name, { changes: [{ field: "active", from: String(!w.active), to: String(w.active) }] });
  return c.json(wfShape(w));
});
r.get("/webhooks", can("viewDev"), async (c) => c.json((await query("SELECT id,url,events,status,secret_hint FROM webhooks WHERE org_id=$1 ORDER BY created_at DESC", [c.get("user").org_id])).rows));

export default r;

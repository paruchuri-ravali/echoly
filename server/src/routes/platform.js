import { Hono } from "hono";
import { z } from "zod";
import { SESv2Client, CreateEmailIdentityCommand, GetEmailIdentityCommand, DeleteEmailIdentityCommand } from "@aws-sdk/client-sesv2";
import { query } from "../db/pool.js";
import { can, assertProject, userCan } from "../middleware/can.js";
import { body } from "../lib/validate.js";
import { audit, diff } from "../lib/audit.js";
import { HttpError, notFound, forbidden, invalid, conflict } from "../lib/errors.js";
import { newId, pageParams, pageResult, EMAIL_RE } from "../lib/util.js";
import { catalog, defaultBranding, PROVIDER_FIELDS, PROVIDER_NAMES } from "../lib/catalog.js";
import { encrypt } from "../lib/secrets.js";
import { notifFilter } from "./messaging.js";

const r = new Hono();
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const daysOf = (q) => (q.from ? Math.min(60, Math.max(1, Math.round((Date.parse(q.to ?? new Date().toISOString()) - Date.parse(q.from)) / 86400000) + 1)) : 14);
const SETTLED_OK = ["delivered", "read"];

// ---------------- overview & analytics ----------------
async function daySeries(user, q, days) {
  const f = notifFilter(user, { ...q, from: undefined, to: undefined });
  const rows = (await query(
    `SELECT to_char(d::date,'YYYY-MM-DD') AS date,
       count(n.id)::int AS total,
       count(*) FILTER (WHERE n.status IN ('delivered','read','sent'))::int AS delivered,
       count(*) FILTER (WHERE n.status IN ('failed','expired'))::int AS failed,
       count(*) FILTER (WHERE n.status IN ('queued','scheduled','sending'))::int AS pending
     FROM generate_series(current_date - ($${f.args.length + 1}::int - 1), current_date, interval '1 day') d
     LEFT JOIN notifications n ON n.created_at::date = d::date AND ${f.where}
     GROUP BY d ORDER BY d`, [...f.args, days])).rows;
  return rows;
}

r.get("/overview", async (c) => {
  const u = c.get("user"); const q = c.req.query(); const f = notifFilter(u, q);
  const t = (await query(
    `SELECT count(*)::int total,
       count(*) FILTER (WHERE status IN ('delivered','read'))::int delivered,
       count(*) FILTER (WHERE status IN ('delivered','read','sent'))::int ok,
       count(*) FILTER (WHERE status IN ('failed','expired'))::int failed,
       count(*) FILTER (WHERE status IN ('queued','scheduled','sending'))::int pending,
       count(*) FILTER (WHERE status = 'cancelled')::int cancelled
     FROM notifications n WHERE ${f.where}`, f.args)).rows[0];
  const settled = t.ok + t.failed; // 'sent' counts as success until provider delivery receipts are wired
  const sent = t.total - t.pending - t.cancelled;
  const byCh = (await query(`SELECT ch AS channel, count(*)::int count FROM notifications n, jsonb_array_elements_text(n.channels) ch WHERE ${f.where} GROUP BY ch`, f.args)).rows;
  const recent = (await query(`SELECT * FROM notifications n WHERE ${f.where} ORDER BY n.created_at DESC LIMIT 8`, f.args)).rows;
  const active = (await query("SELECT count(*)::int n FROM projects WHERE org_id=$1 AND status='active' AND ($2::text[] IS NULL OR id = ANY($2))", [u.org_id, u.projectIds])).rows[0].n;
  const provs = (await query("SELECT provider,channel,health FROM providers WHERE org_id=$1 AND enabled ORDER BY priority", [u.org_id])).rows;
  const alerts = [];
  if (t.failed > 0) alerts.push({ id: "al_failed", level: "warning", message: `${t.failed} failed notification${t.failed > 1 ? "s" : ""} in the selected range`, at: new Date().toISOString() });
  return c.json({
    totals: { total: t.total, sent, delivered: t.delivered, failed: t.failed, pending: t.pending, success_pct: settled ? (t.ok / settled) * 100 : 0 },
    active_projects: active,
    series: (await daySeries(u, q, daysOf(q))).map(({ date, delivered, failed, pending }) => ({ date, delivered, failed, pending })),
    by_channel: ["email", "whatsapp"].map((ch) => ({ channel: ch, count: byCh.find((x) => x.channel === ch)?.count ?? 0 })),
    provider_health: provs.map((p) => ({ provider: PROVIDER_NAMES[p.provider] ?? p.provider, channel: p.channel, health: p.health, error_rate_pct: 0 })),
    recent: recent.map((n) => ({ id: n.id, project_id: n.project_id, environment_id: n.environment_id, env: n.env, category: n.category, priority: n.priority, status: n.status, channels: n.channels, recipient: n.recipient, template_key: n.template_key, created_at: n.created_at, send_at: n.send_at, idempotency_key: n.idempotency_key })),
    alerts,
  });
});

async function latencySeries(u, q, days) {
  const f = notifFilter(u, { ...q, from: undefined, to: undefined });
  const rows = (await query(
    `SELECT to_char(n.created_at::date,'YYYY-MM-DD') date,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY (a->>'latency_ms')::int) p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY (a->>'latency_ms')::int) p95
     FROM notifications n, jsonb_array_elements(n.deliveries) dl, jsonb_array_elements(dl->'attempts') a
     WHERE ${f.where} AND n.created_at >= current_date - ($${f.args.length + 1}::int - 1) GROUP BY 1`, [...f.args, days])).rows;
  const m = new Map(rows.map((x) => [x.date, x]));
  return (await daySeries(u, q, days)).map((d) => ({ date: d.date, p50: Math.round(num(m.get(d.date)?.p50)), p95: Math.round(num(m.get(d.date)?.p95)) }));
}

r.get("/analytics", async (c) => {
  const u = c.get("user"); const q = c.req.query(); const f = notifFilter(u, q); const days = daysOf(q);
  const pct = (ok, bad) => (ok + bad ? (ok / (ok + bad)) * 100 : 0);
  const ch = (await query(
    `SELECT ch AS channel, count(*)::int count,
       count(*) FILTER (WHERE status IN ('delivered','read','sent'))::int ok, count(*) FILTER (WHERE status IN ('failed','expired'))::int bad
     FROM notifications n, jsonb_array_elements_text(n.channels) ch WHERE ${f.where} GROUP BY ch`, f.args)).rows;
  const byProject = (await query(`SELECT p.name AS project, count(n.id)::int count FROM projects p LEFT JOIN notifications n ON n.project_id=p.id AND ${f.where.replaceAll("n.org_id=$1", "n.org_id=$1")} WHERE p.org_id=$1 AND p.status='active' AND ($2::text[] IS NULL OR p.id = ANY($2)) GROUP BY p.name ORDER BY count DESC`, f.args)).rows;
  const prov = (await query(
    `SELECT dl->>'provider' AS provider, count(*)::int sent,
       count(*) FILTER (WHERE dl->>'status' IN ('sent','delivered','read'))::int ok,
       count(*) FILTER (WHERE dl->>'status' = 'failed')::int bad,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY (a->>'latency_ms')::int) p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY (a->>'latency_ms')::int) p95
     FROM notifications n, jsonb_array_elements(n.deliveries) dl, jsonb_array_elements(dl->'attempts') a WHERE ${f.where} GROUP BY 1`, f.args)).rows;
  const retries = (await query(`SELECT jsonb_array_length(dl->'attempts')::int attempts, count(*)::int count FROM notifications n, jsonb_array_elements(n.deliveries) dl WHERE ${f.where} GROUP BY 1`, f.args)).rows;
  return c.json({
    series: (await daySeries(u, q, days)).map(({ date, total, delivered, failed }) => ({ date, total, delivered, failed })),
    by_channel: ["email", "whatsapp"].map((name) => { const x = ch.find((y) => y.channel === name); return { channel: name, count: x?.count ?? 0, success_pct: x ? pct(x.ok, x.bad) : 0 }; }),
    by_project: byProject,
    providers: prov.map((p) => ({ provider: PROVIDER_NAMES[p.provider] ?? p.provider, sent: p.sent, success_pct: pct(p.ok, p.bad), p50_ms: Math.round(num(p.p50)), p95_ms: Math.round(num(p.p95)) })),
    latency: await latencySeries(u, q, days),
    retries: [1, 2, 3, 4, 5].map((n) => ({ attempts: n, count: retries.find((x) => x.attempts === n)?.count ?? 0 })),
    estimated_cost: null,
  });
});

// ---------------- logs & monitoring ----------------
r.get("/logs/queues", can("viewLogs"), async (c) => {
  const u = c.get("user"); const f = notifFilter(u, {});
  const pending = (await query(`SELECT count(*) FILTER (WHERE status IN ('queued','sending'))::int depth, count(*) FILTER (WHERE status='failed')::int dlq, COALESCE(extract(epoch FROM now() - min(created_at) FILTER (WHERE status IN ('queued','sending'))),0)::int age FROM notifications n WHERE ${f.where}`, f.args)).rows[0];
  return c.json([
    { queue: "critical", depth: 0, oldest_age_s: 0, in_flight: 0, dlq: 0 },
    { queue: "standard", depth: pending.depth, oldest_age_s: pending.age, in_flight: 0, dlq: pending.dlq },
    { queue: "bulk", depth: 0, oldest_age_s: 0, in_flight: 0, dlq: 0 },
    { queue: "retry", depth: 0, oldest_age_s: 0, in_flight: 0, dlq: 0 },
  ]);
});
r.get("/logs/dead-letters", can("viewLogs"), async (c) => {
  const f = notifFilter(c.get("user"), {});
  const rows = (await query(`SELECT * FROM notifications n WHERE ${f.where} AND n.status='failed' ORDER BY n.created_at DESC LIMIT 50`, f.args)).rows;
  return c.json(rows.map((n) => { const a = n.deliveries[0]?.attempts ?? []; return { id: `dlq_${n.id}`, notification_id: n.id, queue: "standard", reason: a[a.length - 1]?.error_message ?? "failed", failed_at: a[a.length - 1]?.at ?? n.created_at, attempts: a.length }; }));
});
r.get("/logs/webhook-deliveries", can("viewLogs"), async (c) => c.json({ data: [], next_cursor: null, total: 0 }));
r.get("/logs/latency", can("viewLogs"), async (c) => c.json(await latencySeries(c.get("user"), c.req.query(), daysOf(c.req.query()))));

// ---------------- channels, providers, senders ----------------
async function ensureDefaultProviders(org_id) {
  const has = (await query("SELECT 1 FROM providers WHERE org_id=$1 AND channel='email' LIMIT 1", [org_id])).rowCount;
  if (!has) await query("INSERT INTO providers (id,org_id,channel,provider,name,priority,secret_hint,health,config) VALUES ($1,$2,'email','aws_ses','AWS SES',1,'IAM role (no key stored)','healthy',$3)", [newId("prv"), org_id, JSON.stringify({ region: process.env.AWS_REGION ?? "" })]);
}
async function provShape(p) {
  const st = (await query(
    `SELECT count(*)::int sent, count(*) FILTER (WHERE dl->>'status' IN ('sent','delivered','read'))::int delivered,
       count(*) FILTER (WHERE dl->>'status'='failed')::int failed, COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY (a->>'latency_ms')::int),0)::int p95
     FROM notifications n, jsonb_array_elements(n.deliveries) dl, jsonb_array_elements(dl->'attempts') a WHERE n.org_id=$1 AND dl->>'provider'=$2`, [p.org_id, p.provider])).rows[0];
  return { id: p.id, channel: p.channel, provider: p.provider, name: p.name, enabled: p.enabled, priority: p.priority, secret_hint: p.secret_hint, health: p.health,
    stats: { sent: st.sent, delivered: st.delivered, failed: st.failed, p95_latency_ms: st.p95 }, last_tested_at: p.last_tested_at, config: p.config };
}
r.get("/channels/:ch", can("viewChannels"), async (c) => {
  const ch = c.req.param("ch"); const u = c.get("user");
  if (!catalog[ch]) throw notFound("Channel");
  await ensureDefaultProviders(u.org_id);
  const rows = (await query("SELECT * FROM providers WHERE org_id=$1 AND channel=$2 ORDER BY priority", [u.org_id, ch])).rows;
  return c.json({ channel: ch, status: ch === "email" || ch === "whatsapp" ? "available" : "pending", providers: await Promise.all(rows.map(provShape)), catalog: catalog[ch], fallback_to: ch === "whatsapp" ? "email" : null });
});
function checkCreds(provider, config = {}, secrets = {}, partial = false) {
  for (const f of PROVIDER_FIELDS[provider] ?? []) {
    const v = String((f.secret ? secrets : config)[f.key] ?? "").trim();
    if (!v && partial && f.secret) continue;
    if (!v) throw invalid(`${f.label}: required`);
  }
}
const secretHint = (provider, secrets = {}) => { const f = (PROVIDER_FIELDS[provider] ?? []).find((x) => x.secret); const v = String(secrets[f?.key] ?? ""); return v ? "••••••••" + v.slice(-4) : ""; };

r.post("/channels/:ch/providers", can("writeProviders", "Your role cannot change provider credentials"),
  body(z.object({ provider: z.string(), name: z.string().optional(), config: z.record(z.string()).optional(), secrets: z.record(z.string()).optional() })), async (c) => {
    const b = c.req.valid("json"); const u = c.get("user"); const ch = c.req.param("ch");
    if (!PROVIDER_FIELDS[b.provider]) throw invalid("Unknown provider");
    checkCreds(b.provider, b.config, b.secrets);
    const n = (await query("SELECT count(*)::int n FROM providers WHERE org_id=$1 AND channel=$2", [u.org_id, ch])).rows[0].n;
    const config = { ...(b.config ?? {}), ...(b.provider === "meta_cloud_api" ? { webhook_verify_token: "vt_" + newId("t").slice(2) } : {}) };
    const p = (await query("INSERT INTO providers (id,org_id,channel,provider,name,priority,secret_hint,config,secrets_enc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [newId("prv"), u.org_id, ch, b.provider, b.name || PROVIDER_NAMES[b.provider], n + 1, secretHint(b.provider, b.secrets), JSON.stringify(config), encrypt(b.secrets ?? {})])).rows[0];
    await audit(c, "provider.added", `${p.name} (${ch})`, { changes: [{ field: "credentials", from: "", to: "stored encrypted (not shown)" }] });
    return c.json(await provShape(p));
  });
async function loadProv(c) {
  const p = (await query("SELECT * FROM providers WHERE id=$1 AND org_id=$2", [c.req.param("id"), c.get("user").org_id])).rows[0];
  if (!p) throw notFound("Provider");
  return p;
}
r.post("/providers/:id/credentials", can("writeProviders", "Your role cannot change provider credentials"), body(z.object({ config: z.record(z.string()).optional(), secrets: z.record(z.string()).optional() })), async (c) => {
  const p = await loadProv(c); const b = c.req.valid("json");
  checkCreds(p.provider, b.config, b.secrets, true);
  const hint = secretHint(p.provider, b.secrets);
  const row = (await query("UPDATE providers SET config = config || $2::jsonb, secret_hint = COALESCE(NULLIF($3,''), secret_hint), secrets_enc = COALESCE($4, secrets_enc), health='unknown', last_tested_at=NULL WHERE id=$1 RETURNING *",
    [p.id, JSON.stringify(b.config ?? {}), hint, hint ? encrypt(b.secrets) : null])).rows[0];
  await audit(c, "provider.credentials_updated", p.name, { changes: [{ field: "credentials", from: p.secret_hint, to: hint ? "replaced (not shown)" : "settings updated" }] });
  return c.json(await provShape(row));
});
r.post("/providers/:id/test", can("writeProviders"), async (c) => {
  const p = await loadProv(c); const t0 = Date.now();
  let ok = true, message = "Connection test succeeded.";
  if (p.provider === "aws_ses") {
    try { await new SESv2Client({ region: process.env.AWS_REGION }).send(new GetEmailIdentityCommand({ EmailIdentity: process.env.SES_FROM || "x@example.com" })); }
    catch (e) { if (e.name !== "NotFoundException") { ok = false; message = `SES check failed: ${e.message}`; } }
    const v = (await query("SELECT 1 FROM senders WHERE org_id=$1 AND status='verified'", [p.org_id])).rowCount;
    if (ok && !v) message += " Warning: no verified sender yet, so sends will use the default SES address.";
  } else message = "Stored credentials are saved. Live connection tests for this provider are not available yet.";
  await query("UPDATE providers SET last_tested_at=now(), health=$2 WHERE id=$1", [p.id, ok ? "healthy" : "down"]);
  return c.json({ ok, latency_ms: Date.now() - t0, message });
});
r.patch("/providers/:id", can("writeProviders"), body(z.object({ enabled: z.boolean().optional(), priority: z.number().int().optional() })), async (c) => {
  const p = await loadProv(c); const b = c.req.valid("json");
  return c.json(await provShape((await query("UPDATE providers SET enabled=COALESCE($2,enabled), priority=COALESCE($3,priority) WHERE id=$1 RETURNING *", [p.id, b.enabled, b.priority])).rows[0]));
});
r.delete("/providers/:id", can("writeProviders"), async (c) => {
  const p = await loadProv(c); await query("DELETE FROM providers WHERE id=$1", [p.id]);
  await audit(c, "provider.removed", p.name); return c.body(null, 204);
});

const sesClient = () => new SESv2Client({ region: process.env.AWS_REGION });
const sndShape = (s) => ({ id: s.id, email: s.email, name: s.name, provider: s.provider, status: s.status, is_default: s.is_default, created_at: s.created_at, verified_at: s.verified_at, message: s.message ?? undefined });
r.get("/senders", can("viewChannels"), async (c) => c.json((await query("SELECT * FROM senders WHERE org_id=$1 ORDER BY created_at", [c.get("user").org_id])).rows.map(sndShape)));
r.post("/senders", can("writeProviders", "Your role cannot manage sender emails"), body(z.object({ email: z.string().regex(EMAIL_RE, "Enter a valid sender email"), name: z.string().trim().min(1, "Sender name is required"), provider: z.string().optional() })), async (c) => {
  const b = c.req.valid("json"); const u = c.get("user");
  const first = !(await query("SELECT 1 FROM senders WHERE org_id=$1", [u.org_id])).rowCount;
  let message = null;
  try { await sesClient().send(new CreateEmailIdentityCommand({ EmailIdentity: b.email })); message = "Verification email sent. Click the link in it, then press Verify."; }
  catch (e) { message = e.name === "AlreadyExistsException" ? "Already registered with SES. Press Verify to check." : `Could not register with SES: ${e.message}`; }
  try {
    const s = (await query("INSERT INTO senders (id,org_id,email,name,provider,is_default,message) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [newId("snd"), u.org_id, b.email.toLowerCase(), b.name, b.provider ?? "aws_ses", first, message])).rows[0];
    await audit(c, "sender.added", `${s.name} <${s.email}>`);
    return c.json(sndShape(s));
  } catch (e) { throw e.code === "23505" ? conflict("That sender already exists") : e; }
});
async function loadSender(c) {
  const s = (await query("SELECT * FROM senders WHERE id=$1 AND org_id=$2", [c.req.param("id"), c.get("user").org_id])).rows[0];
  if (!s) throw notFound("Sender"); return s;
}
r.post("/senders/:id/verify", can("writeProviders", "Your role cannot manage sender emails"), async (c) => {
  const s = await loadSender(c); let status = "pending", message = null;
  try {
    const r2 = await sesClient().send(new GetEmailIdentityCommand({ EmailIdentity: s.email }));
    if (r2.VerifiedForSendingStatus) status = "verified"; else message = "Not verified yet. Open the verification email from AWS and click the link, then try again.";
  } catch (e) { status = "failed"; message = `SES check failed: ${e.message}`; }
  const row = (await query("UPDATE senders SET status=$2, message=$3, verified_at=CASE WHEN $2='verified' THEN now() ELSE verified_at END WHERE id=$1 RETURNING *", [s.id, status, message])).rows[0];
  if (status === "verified") await audit(c, "sender.verified", s.email);
  return c.json(sndShape(row));
});
r.patch("/senders/:id", can("writeProviders", "Your role cannot manage sender emails"), body(z.object({ is_default: z.boolean().optional(), name: z.string().min(1).optional() })), async (c) => {
  const s = await loadSender(c); const b = c.req.valid("json");
  if (b.is_default) {
    if (s.status !== "verified") throw invalid("Only a verified sender can be the default");
    await query("UPDATE senders SET is_default = (id=$2) WHERE org_id=$1", [s.org_id, s.id]); await audit(c, "sender.default_changed", s.email);
  }
  if (b.name) await query("UPDATE senders SET name=$2 WHERE id=$1", [s.id, b.name]);
  return c.json(sndShape((await query("SELECT * FROM senders WHERE id=$1", [s.id])).rows[0]));
});
r.delete("/senders/:id", can("writeProviders", "Your role cannot manage sender emails"), async (c) => {
  const s = await loadSender(c);
  await sesClient().send(new DeleteEmailIdentityCommand({ EmailIdentity: s.email })).catch(() => {});
  await query("DELETE FROM senders WHERE id=$1", [s.id]);
  if (s.is_default) await query("UPDATE senders SET is_default=true WHERE id=(SELECT id FROM senders WHERE org_id=$1 AND status='verified' ORDER BY created_at LIMIT 1)", [s.org_id]);
  await audit(c, "sender.removed", s.email); return c.body(null, 204);
});

// ---------------- branding ----------------
const HEX = /^#[0-9a-fA-F]{6}$/;
async function brandingFor(c, pid) {
  const u = c.get("user");
  const p = (await query("SELECT id,name FROM projects WHERE id=$1 AND org_id=$2", [pid, u.org_id])).rows[0];
  if (!p) throw notFound("Project");
  assertProject(u, pid);
  const row = (await query("SELECT data FROM brandings WHERE project_id=$1", [pid])).rows[0];
  return { p, current: { ...defaultBranding, sender_name: p.name, ...(row?.data ?? {}) } };
}
r.get("/projects/:id/branding", async (c) => c.json((await brandingFor(c, c.req.param("id"))).current));
r.put("/projects/:id/branding", can("editBranding"), async (c) => {
  const pid = c.req.param("id"); const { p, current } = await brandingFor(c, pid);
  const b = await c.req.json().catch(() => ({}));
  const allowed = Object.keys(defaultBranding);
  const next = { ...defaultBranding, sender_name: p.name };
  for (const k of allowed) if (k in b) next[k] = b[k];
  for (const [k, v] of Object.entries(next)) if ((k.endsWith("_color") || k.endsWith("_bg")) && v && !HEX.test(String(v))) throw invalid(`${k} must be a hex color like #4f46e5`);
  if (Array.isArray(next.social_links) && next.social_links.some((s) => !/^https:\/\//.test(s.url))) throw invalid("social link URLs must be https");
  if (next.logo_url && !/^https:\/\//.test(next.logo_url)) throw invalid("logo_url must be an https URL");
  await query("INSERT INTO brandings (project_id,data) VALUES ($1,$2) ON CONFLICT (project_id) DO UPDATE SET data=$2", [pid, JSON.stringify(next)]);
  await audit(c, "branding.updated", p.name, { project_id: pid, changes: diff(current, next) });
  return c.json(next);
});

// ---------------- search, security, openapi ----------------
r.get("/search", async (c) => {
  const u = c.get("user"); const s = (c.req.query("q") ?? "").trim();
  if (s.length < 2) return c.json([]);
  const like = `%${s}%`;
  const n = (await query("SELECT id,status FROM notifications WHERE org_id=$1 AND ($2::text[] IS NULL OR project_id = ANY($2)) AND (id ILIKE $3 OR recipient ILIKE $3) ORDER BY created_at DESC LIMIT 4", [u.org_id, u.projectIds, like])).rows;
  const t = (await query("SELECT id,name FROM templates WHERE org_id=$1 AND ($2::text[] IS NULL OR project_id IS NULL OR project_id = ANY($2)) AND (key ILIKE $3 OR name ILIKE $3) LIMIT 5", [u.org_id, u.projectIds, like])).rows;
  const p = (await query("SELECT id,name FROM projects WHERE org_id=$1 AND ($2::text[] IS NULL OR id = ANY($2)) AND name ILIKE $3 LIMIT 5", [u.org_id, u.projectIds, like])).rows;
  return c.json([
    ...n.map((x) => ({ type: "notification", id: x.id, label: `${x.id} · ${x.status}`, to: `/notifications/${x.id}` })),
    ...t.map((x) => ({ type: "template", id: x.id, label: x.name, to: `/templates/${x.id}` })),
    ...p.map((x) => ({ type: "project", id: x.id, label: x.name, to: `/projects/${x.id}` })),
  ]);
});
r.get("/security-events", can("viewAdmin"), async (c) => c.json([]));

export default r;

import { newId, slugify, sha256, randomToken } from "../lib/util.js";
import { gallery, defaultBranding } from "../lib/catalog.js";
import { varsOf } from "../lib/render.js";

// Deterministic PRNG so every run produces the same-looking (but varied) data.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(20261117);
const pick = (a) => a[Math.floor(R() * a.length)];
const wpick = (pairs) => { let x = R() * pairs.reduce((s, [, w]) => s + w, 0); for (const [v, w] of pairs) if ((x -= w) < 0) return v; return pairs[0][0]; };
const between = (a, b) => a + Math.floor(R() * (b - a + 1));
const iso = (ms) => new Date(ms).toISOString();
const DAY = 86_400_000, MIN = 60_000;

const FIRST = ["Aarav", "Priya", "Liam", "Sofia", "Noah", "Emma", "Mateo", "Olivia", "Arjun", "Mia", "Lucas", "Ananya", "Ethan", "Isabella", "Kabir", "Zara", "Daniel", "Chloe", "Rohan", "Hannah", "Omar", "Layla", "Ben", "Nina", "Vikram", "Grace", "Yuki", "Carlos", "Fatima", "Tom"];
const LAST = ["Sharma", "Patel", "Johnson", "Garcia", "Nguyen", "Brown", "Singh", "Kim", "Martin", "Rossi", "Khan", "Reddy", "Walker", "Silva", "Cohen", "Ali", "Moore", "Lopez", "Iyer", "Clark"];
const DOMAINS = ["gmail.com", "outlook.com", "yahoo.com", "icloud.com", "proton.me", "fastmail.com"];
const person = () => {
  const f = pick(FIRST), l = pick(LAST);
  const email = `${f}.${l}${R() < 0.3 ? between(1, 99) : ""}@${pick(DOMAINS)}`.toLowerCase();
  const phone = `+1${between(2, 9)}${between(10, 99)}${between(5550000, 5559999)}`.slice(0, 12);
  return { name: f, email, phone };
};
const mask = (v, ch) => (ch === "email" ? v.replace(/^(.).*@/, "$1***@") : `+** *** **${v.slice(-2)}`);

// ---- project profiles: which templates each project mostly sends, and how busy it is ----
const PROJECTS = [
  { name: "Northwind Commerce", description: "Storefront order, shipping and account emails.", weight: 5, brand: { brand_color: "#0f766e", accent_color: "#f59e0b", sender_name: "Northwind", tagline: "Everyday goods, delivered.", footer_text: "You received this because you shop at Northwind.", postal_address: "88 Harbor St, Portland, OR 97204" },
    mix: [["order-confirmation", 40], ["shipping-update", 28], ["password-reset", 8], ["otp-code", 14], ["welcome", 10]] },
  { name: "Helio Health", description: "Clinic appointment reminders and patient verification.", weight: 3, brand: { brand_color: "#2563eb", accent_color: "#14b8a6", sender_name: "Helio Health", tagline: "Care that remembers.", footer_text: "Helio Health patient notifications.", postal_address: "410 Mercy Ave, Austin, TX 78701" },
    mix: [["appointment-reminder", 55], ["otp-code", 25], ["password-reset", 8], ["welcome", 12]] },
  { name: "Paperplane Docs", description: "SaaS product onboarding, invoices and security codes.", weight: 2, brand: { brand_color: "#7c3aed", accent_color: "#ec4899", sender_name: "Paperplane", tagline: "Docs that fly.", footer_text: "Sent by Paperplane Docs.", postal_address: "1 Market Plaza, San Francisco, CA 94105" },
    mix: [["welcome", 30], ["invoice-ready", 25], ["password-reset", 20], ["otp-code", 25]] },
];

const btn = (href, label) => `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;padding:11px 22px;background:#4f46e5;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p>`;
const EXTRA_TEMPLATES = [
  { key: "shipping-update", name: "Shipping update", project: "Northwind Commerce", sample: { name: "Alex", order_id: "NW-20418", carrier: "UPS", eta: "Thu 20 Nov", link: "https://northwind.example/track/NW-20418" },
    content: { email: { subject: "Your order {{order_id}} has shipped", body: `<h2 style="margin:0 0 12px">On its way</h2><p>Hi {{name}}, order <strong>{{order_id}}</strong> shipped with {{carrier}} and should arrive by <strong>{{eta}}</strong>.</p>${btn("{{link}}", "Track package")}` }, whatsapp: { body: "Hi {{name}}, order {{order_id}} shipped via {{carrier}}, ETA {{eta}}. Track: {{link}}" } } },
  { key: "invoice-ready", name: "Invoice ready", project: "Paperplane Docs", sample: { name: "Alex", invoice_no: "INV-2291", amount: "$129.00", due: "30 Nov", link: "https://paperplane.example/invoices/2291" },
    content: { email: { subject: "Invoice {{invoice_no}} for {{amount}} is ready", body: `<h2 style="margin:0 0 12px">Your invoice is ready</h2><p>Hi {{name}}, invoice <strong>{{invoice_no}}</strong> for <strong>{{amount}}</strong> is due on {{due}}.</p>${btn("{{link}}", "View invoice")}` } } },
];

const DATA_FOR = {
  "order-confirmation": (p) => ({ name: p.name, order_id: `NW-${between(20000, 20999)}`, total: `$${between(12, 240)}.${String(between(0, 99)).padStart(2, "0")}`, link: "https://northwind.example/orders" }),
  "shipping-update": (p) => ({ name: p.name, order_id: `NW-${between(20000, 20999)}`, carrier: pick(["UPS", "FedEx", "USPS", "DHL"]), eta: pick(["Thu 20 Nov", "Fri 21 Nov", "Mon 24 Nov"]), link: "https://northwind.example/track" }),
  "password-reset": (p) => ({ name: p.name, app_name: "Echoly", link: `https://app.example/reset/${randomToken(6)}`, expires_in: "30 minutes" }),
  "otp-code": (p) => ({ name: p.name, app_name: "Echoly", code: String(between(100000, 999999)), expires_in: "10 minutes" }),
  "welcome": (p) => ({ name: p.name, app_name: "Echoly", link: "https://app.example/start" }),
  "appointment-reminder": (p) => ({ name: p.name, date: pick(["Fri 21 Nov", "Mon 24 Nov", "Tue 25 Nov", "Wed 26 Nov"]), time: pick(["9:00 AM", "10:30 AM", "1:15 PM", "3:45 PM"]), place: "Helio Clinic, Suite 4" }),
  "invoice-ready": (p) => ({ name: p.name, invoice_no: `INV-${between(2000, 2999)}`, amount: `$${between(19, 499)}.00`, due: "30 Nov", link: "https://paperplane.example/invoices" }),
};
const CATEGORY = { "otp-code": "security", "password-reset": "security", "welcome": "lifecycle", "appointment-reminder": "reminder" };

const ERRORS = {
  email: [["mailbox_full", "Recipient mailbox is full", 422], ["invalid_recipient", "550 5.1.1 The email account does not exist", 550], ["provider_timeout", "Upstream provider timed out after 10000ms", 504], ["rate_limited", "Provider rate limit exceeded, retry later", 429]],
  whatsapp: [["not_on_whatsapp", "Recipient phone number is not registered on WhatsApp", 131026], ["template_not_approved", "Message template is not approved for this language", 132001], ["provider_timeout", "Upstream provider timed out after 10000ms", 504]],
};
const PROVIDER = { email: "aws_ses", whatsapp: "meta_cloud_api" };

function buildNotification({ org, project, env, tpl, ch, createdMs, status, p, idem }) {
  const data = DATA_FOR[tpl]?.(p) ?? { name: p.name };
  const raw = ch === "email" ? p.email : p.phone;
  const provider = PROVIDER[ch];
  const attemptsCount = status === "failed" ? between(2, 4) : R() < 0.06 ? 2 : 1;
  const attempts = [];
  let t = createdMs + between(300, 900);
  for (let i = 1; i <= attemptsCount; i++) {
    const last = i === attemptsCount, fail = status === "failed" || !last;
    const [code, msg] = fail ? pick(ERRORS[ch]) : [null, null];
    const latency = fail ? between(1500, 10_000) : Math.round(120 + Math.pow(R(), 2.5) * 1800);
    attempts.push({ id: newId("att"), attempt_no: i, provider, status: fail ? "failed" : "success", error_code: code, error_message: msg, latency_ms: latency, provider_response: fail ? { code } : { message_id: `${provider === "aws_ses" ? "0100019" : "wamid."}${randomToken(9)}` }, at: iso(t) });
    t += fail ? 2000 * i * i : 0;
  }
  const delivered = ["delivered", "read"].includes(status);
  const dStatus = status === "failed" ? "failed" : delivered ? "delivered" : status === "sent" ? "sent" : "pending";
  const deliveries = ["queued", "scheduled", "cancelled"].includes(status) ? [] : [{ id: newId("dlv"), channel: ch, provider, status: dStatus, attempts, provider_message_id: attempts.at(-1).provider_response.message_id ?? null }];
  const timeline = [];
  for (const a of attempts) timeline.push({ type: a.status === "success" ? "sent" : "attempt_failed", at: a.at, ...(a.error_code ? { detail: a.error_code } : {}) });
  const endMs = t;
  if (delivered) timeline.push({ type: "delivered", at: iso(endMs + between(1, 9) * 1000) });
  if (status === "read") timeline.push({ type: "read", at: iso(endMs + between(1, 90) * MIN) });
  if (status === "failed") timeline.push({ type: "failed", at: iso(endMs) });
  if (status === "cancelled") timeline.push({ type: "cancelled", at: iso(createdMs + between(1, 20) * MIN) });
  return {
    id: newId("ntf"), org_id: org, project_id: project.id, env: env.kind, environment_id: env.id, category: CATEGORY[tpl] ?? "transactional",
    priority: tpl === "otp-code" ? "critical" : tpl === "password-reset" ? "high" : "normal", status, channels: [ch], recipient: mask(raw, ch), recipient_raw: raw,
    template_key: tpl, data, idempotency_key: idem, send_at: status === "scheduled" ? iso(createdMs + between(2, 20) * 3_600_000) : null, created_at: iso(createdMs),
    deliveries, timeline, cancellable: ["queued", "scheduled"].includes(status),
  };
}

const AUDIT = [
  ["project.created", (pr) => pr.name, 29], ["provider.added", () => "AWS SES (email)", 28], ["sender.verified", () => "notifications@echoly.app", 28],
  ["api_key.created", (pr) => `${pr.name} · prod backend`, 26], ["template.created", () => "Order confirmation (from gallery)", 24],
  ["user.invited", () => "developer@example.com", 22], ["template.published", () => "password-reset v2", 18], ["branding.updated", (pr) => `${pr.name} email branding`, 15],
  ["workflow.updated", () => "Abandoned cart nudge", 11], ["api_key.rotated", (pr) => `${pr.name} · staging`, 8], ["schedule.created", () => "appointment-reminder → patient batch", 4],
  ["provider.credentials_updated", () => "AWS SES", 3], ["template.published", () => "order-confirmation v2", 2],
];

/**
 * Fills an organization with realistic demo content. Idempotent: does nothing if the org already
 * has notifications. Pass `{ force: true }` after wiping to regenerate.
 * `db` is a pg client (inside a transaction) or the pool.
 */
export async function seedDemoData(db, orgId, { days = 30, total = 900 } = {}) {
  if ((await db.query("SELECT count(*)::int n FROM notifications WHERE org_id=$1", [orgId])).rows[0].n >= 100) return false; // already populated; a few hand-made test rows are kept
  const now = Date.now();
  const users = (await db.query("SELECT u.email,u.name,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.org_id=$1", [orgId])).rows;
  const actor = (role) => users.find((u) => u.role === role) ?? users[0] ?? { email: "admin@example.com", name: "Main Admin", role: "org_admin" };

  // projects (reuse existing by slug, create the rest) + environments
  const projects = [];
  for (const def of PROJECTS) {
    const slug = slugify(def.name);
    let pr = (await db.query("SELECT id,name FROM projects WHERE org_id=$1 AND slug=$2", [orgId, slug])).rows[0];
    if (!pr) {
      pr = (await db.query("INSERT INTO projects (id,org_id,name,slug,description,daily_quota,rate_per_minute,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name",
        [newId("prj"), orgId, def.name, slug, def.description, def.weight * 5000, 120, iso(now - 30 * DAY)])).rows[0];
      for (const k of ["dev", "staging", "prod"]) await db.query("INSERT INTO environments (id,project_id,kind) VALUES ($1,$2,$3)", [newId("env"), pr.id, k]);
    }
    const envs = (await db.query("SELECT id,kind FROM environments WHERE project_id=$1", [pr.id])).rows;
    projects.push({ ...pr, def, envs });
    await db.query("INSERT INTO brandings (project_id,data) VALUES ($1,$2) ON CONFLICT (project_id) DO NOTHING", [pr.id, JSON.stringify({ ...defaultBranding, ...def.brand, postal_address: def.brand.postal_address })]);
    // API keys: one per environment with a believable last-used time
    for (const e of envs) {
      const kind = e.kind === "prod" ? "live" : "test", prefix = `nan_${kind}_${randomToken(4)}`;
      await db.query("INSERT INTO api_keys (id,environment_id,name,prefix,secret_hash,status,created_at,last_used_at) VALUES ($1,$2,$3,$4,$5,'active',$6,$7)",
        [newId("key"), e.id, e.kind === "prod" ? "Production backend" : e.kind === "staging" ? "Staging CI" : "Local development", prefix, sha256(randomToken(24)), iso(now - between(10, 28) * DAY), iso(now - (e.kind === "prod" ? between(1, 20) * MIN : between(1, 72) * 60 * MIN))]);
    }
  }
  // staff users get access to every seeded project; clients only the first two (shows role scoping)
  const scoped = (await db.query("SELECT u.id,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.org_id=$1 AND m.project_id IS NOT NULL", [orgId])).rows;
  for (const u of scoped) for (const [i, pr] of projects.entries()) {
    if (u.role === "client" && i > 1) continue;
    await db.query("INSERT INTO memberships (id,user_id,project_id,role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [newId("mem"), u.id, pr.id, u.role]);
  }
  const byName = Object.fromEntries(projects.map((p) => [p.name, p]));

  // templates: org-wide from the gallery (+ a second version for two), project-specific extras
  const tplRow = async (t) => db.query(
    `INSERT INTO templates (id,org_id,key,name,scope,project_id,status,channels,latest_version,sample_data,versions,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
    [newId("tpl"), orgId, t.key, t.name, t.project_id ? "project" : "organization", t.project_id ?? null, JSON.stringify(Object.keys(t.versions.at(-1).content)), t.versions.length, JSON.stringify(t.sample), JSON.stringify(t.versions), iso(t.updated)]);
  const ver = (n, content, author, daysAgo, status = "published") => ({ version: n, status, created_at: iso(now - daysAgo * DAY), author, content, variables: varsOf(content) });
  for (const g of gallery) {
    const v1 = ver(1, g.content, "Main Admin", 27);
    const versions = ["password-reset", "order-confirmation"].includes(g.key)
      ? [v1, ver(2, { ...g.content, email: { ...g.content.email, subject: g.key === "password-reset" ? "Reset your {{app_name}} password (link valid {{expires_in}})" : "Thanks! Order {{order_id}} is confirmed" } }, "Demo Developer", g.key === "password-reset" ? 18 : 2)]
      : [v1];
    await tplRow({ key: g.key, name: g.name, sample: g.sample_data, versions, updated: now - (versions.length > 1 ? (g.key === "password-reset" ? 18 : 2) : 27) * DAY });
  }
  for (const t of EXTRA_TEMPLATES) await tplRow({ key: t.key, name: t.name, project_id: byName[t.project]?.id, sample: t.sample, versions: [ver(1, t.content, "Demo Manager", 20)], updated: now - 20 * DAY });

  // providers + senders
  const prov = (channel, provider, name, priority, hint, health, enabled, config) =>
    db.query("INSERT INTO providers (id,org_id,channel,provider,name,priority,enabled,secret_hint,health,config,last_tested_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [newId("prv"), orgId, channel, provider, name, priority, enabled, hint, health, JSON.stringify(config), iso(now - 2 * DAY), iso(now - 28 * DAY)]);
  if (!(await db.query("SELECT 1 FROM providers WHERE org_id=$1 LIMIT 1", [orgId])).rowCount) {
    await prov("email", "aws_ses", "AWS SES", 1, "IAM role (no key stored)", "healthy", true, { region: "us-east-1" });
    await prov("email", "resend", "Resend (backup)", 2, "••••••••q7Lm", "healthy", true, {});
    await prov("email", "brevo", "Brevo", 3, "••••••••4fa2", "unknown", false, {});
    await prov("whatsapp", "meta_cloud_api", "Meta WhatsApp Cloud API", 1, "••••••••Zx91", "degraded", true, { phone_number_id: "109823746501234", waba_id: "204518937650421" });
  }
  await db.query("INSERT INTO senders (id,org_id,email,name,provider,status,is_default,created_at,verified_at) VALUES ($1,$2,'notifications@echoly.app','Echoly','aws_ses','verified',true,$3,$3) ON CONFLICT DO NOTHING", [newId("snd"), orgId, iso(now - 28 * DAY)]);
  await db.query("INSERT INTO senders (id,org_id,email,name,provider,status,is_default,created_at,verified_at) VALUES ($1,$2,'support@echoly.app','Echoly Support','aws_ses','verified',false,$3,$3) ON CONFLICT DO NOTHING", [newId("snd"), orgId, iso(now - 20 * DAY)]);
  await db.query("INSERT INTO senders (id,org_id,email,name,provider,status,is_default,message,created_at) VALUES ($1,$2,'billing@echoly.app','Echoly Billing','aws_ses','pending',false,'Not verified yet. Open the verification email from AWS and click the link, then try again.',$3) ON CONFLICT DO NOTHING", [newId("snd"), orgId, iso(now - 1 * DAY)]);

  // notifications: weighted by project, with a daily rhythm (busier weekdays, daytime-weighted hours, growth trend)
  const totalWeight = projects.reduce((s, p) => s + p.def.weight, 0);
  const rows = [];
  for (let i = 0; i < total; i++) {
    let x = R() * totalWeight, project = projects[0];
    for (const p of projects) { if ((x -= p.def.weight) < 0) { project = p; break; } }
    const ageDays = Math.pow(R(), 0.85) * days; // slightly more recent traffic
    let createdMs = now - ageDays * DAY;
    const d = new Date(createdMs);
    if ((d.getUTCDay() === 0 || d.getUTCDay() === 6) && R() < 0.45) createdMs -= DAY; // quieter weekends
    d.setTime(createdMs); d.setUTCHours(wpick([[8, 3], [9, 6], [10, 8], [11, 8], [12, 6], [13, 6], [14, 7], [15, 7], [16, 6], [17, 5], [18, 4], [19, 3], [20, 2], [21, 2], [2, 1], [4, 1]]), between(0, 59), between(0, 59));
    createdMs = Math.min(d.getTime(), now - 2 * MIN);
    const tpl = wpick(project.def.mix);
    const tplDef = tpl === "invoice-ready" || tpl === "shipping-update" ? EXTRA_TEMPLATES.find((t) => t.key === tpl) : gallery.find((g) => g.key === tpl);
    const hasWa = "whatsapp" in (tplDef.content ?? {}) && project.name !== "Paperplane Docs";
    const ch = hasWa && R() < 0.3 ? "whatsapp" : "email";
    const env = project.envs.find((e) => e.kind === wpick([["prod", 82], ["staging", 12], ["dev", 6]])) ?? project.envs[0];
    const ageH = (now - createdMs) / 3_600_000;
    let status;
    if (ageH < 0.5 && R() < 0.5) status = "queued";
    else if (ageH < 20 && R() < 0.04) status = "scheduled";
    else status = wpick(ch === "email" ? [["delivered", 80], ["read", 12], ["failed", 5], ["sent", 2], ["cancelled", 1]] : [["delivered", 55], ["read", 32], ["failed", 8], ["sent", 4], ["cancelled", 1]]);
    if (ch === "whatsapp" && project.name === "Helio Health" && R() < 0.1) status = "failed";
    rows.push(buildNotification({ org: orgId, project, env, tpl, ch, createdMs, status, p: person(), idem: R() < 0.4 ? `${tpl}-${randomToken(5)}` : null }));
  }
  for (const n of rows) {
    await db.query(
      `INSERT INTO notifications (id,org_id,project_id,env,environment_id,category,priority,status,channels,recipient,recipient_raw,template_key,data,idempotency_key,send_at,created_at,deliveries,timeline,cancellable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [n.id, n.org_id, n.project_id, n.env, n.environment_id, n.category, n.priority, n.status, JSON.stringify(n.channels), n.recipient, n.recipient_raw, n.template_key,
        JSON.stringify(n.data), n.idempotency_key, n.send_at, n.created_at, JSON.stringify(n.deliveries), JSON.stringify(n.timeline), n.cancellable]);
  }

  // schedules: upcoming, one completed, one cancelled
  const sched = async (project, tpl, recipient, ch, tz, ms, status, last) =>
    db.query("INSERT INTO schedules (id,org_id,project_id,template_key,recipient,channel,timezone,kind,rule,next_run_at,status,last_run_status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'one_off','once',$8,$9,$10,$11)",
      [newId("sch"), orgId, project.id, tpl, recipient, ch, tz, status === "scheduled" ? iso(ms) : null, status, last, iso(now - 3 * DAY)]);
  await sched(byName["Helio Health"], "appointment-reminder", person().email, "email", "America/Chicago", now + 5 * 3_600_000, "scheduled", null);
  await sched(byName["Helio Health"], "appointment-reminder", person().phone, "whatsapp", "America/Chicago", now + 20 * 3_600_000, "scheduled", null);
  await sched(byName["Northwind Commerce"], "shipping-update", person().email, "email", "America/Los_Angeles", now + 2 * DAY, "scheduled", null);
  await sched(byName["Paperplane Docs"], "invoice-ready", person().email, "email", "Europe/London", now + 4 * DAY, "scheduled", null);
  await sched(byName["Northwind Commerce"], "welcome", person().email, "email", "UTC", now - 1 * DAY, "completed", "ok");
  await sched(byName["Paperplane Docs"], "welcome", person().email, "email", "Asia/Kolkata", now + 6 * DAY, "cancelled", null);

  // workflows & webhooks
  const wf = (name, trigger, active, category, conditions, steps, ago) =>
    db.query("INSERT INTO workflows (id,org_id,name,trigger_event,active,category,conditions,steps,version,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [newId("wfl"), orgId, name, trigger, active, category, conditions, JSON.stringify(steps), between(1, 4), iso(now - ago * DAY)]);
  await wf("Order placed → confirmation", "order.created", true, "transactional", "order.total > 0",
    [{ type: "send", template: "order-confirmation", channel: "email" }, { type: "wait", minutes: 60 }, { type: "send", template: "shipping-update", channel: "whatsapp", fallback: "email" }], 5);
  await wf("Abandoned cart nudge", "cart.abandoned", true, "lifecycle", "cart.items >= 1 AND user.marketing_opt_in = true",
    [{ type: "wait", minutes: 120 }, { type: "send", template: "welcome", channel: "email" }], 11);
  await wf("Appointment reminder (24h)", "appointment.booked", true, "reminder", "", [{ type: "wait", until: "24h_before" }, { type: "send", template: "appointment-reminder", channel: "whatsapp", fallback: "email" }], 4);
  await wf("Failed payment dunning", "payment.failed", false, "transactional", "attempt <= 3", [{ type: "send", template: "invoice-ready", channel: "email" }], 15);
  for (const [url, events, status] of [["https://api.northwind.example/hooks/echoly", ["notification.delivered", "notification.failed"], "active"], ["https://hooks.helio.example/echoly/events", ["notification.read", "notification.failed"], "active"], ["https://staging.paperplane.example/webhooks/notify", ["notification.delivered"], "disabled"]]) {
    await db.query("INSERT INTO webhooks (id,org_id,url,events,status,secret_hint,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [newId("whk"), orgId, url, JSON.stringify(events), status, `whsec_••••${randomToken(3).slice(0, 4)}`, iso(now - between(5, 25) * DAY)]);
  }

  // audit log history
  for (const [action, target, ago] of AUDIT) {
    const pr = pick(projects), a = actor(action.startsWith("user") || action.startsWith("provider") || action.startsWith("project") ? "org_admin" : pick(["org_admin", "project_admin", "developer"]));
    await db.query("INSERT INTO audit_logs (id,at,org_id,actor,actor_name,actor_role,action,target,project_id,project_name,ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [newId("aud"), iso(now - ago * DAY - between(0, 600) * MIN), orgId, a.email, a.name, a.role, action, target(pr), pr.id, pr.name, `203.0.113.${between(2, 250)}`]);
  }
  return { projects: projects.length, notifications: rows.length };
}

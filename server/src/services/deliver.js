import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { query } from "../db/pool.js";
import { config } from "../config.js";
import { newId } from "../lib/util.js";
import { renderText } from "../lib/render.js";

let ses;
const now = () => new Date().toISOString();

/** Finds the template the notification should use: the project's own copy first, then the org-level one. */
export async function findTemplate(org_id, project_id, key) {
  return (await query(
    `SELECT * FROM templates WHERE org_id=$1 AND key=$2 AND status='active' AND (project_id=$3 OR project_id IS NULL)
     ORDER BY project_id NULLS LAST LIMIT 1`, [org_id, key, project_id])).rows[0];
}

async function sendEmail(n, tpl) {
  const v = tpl.versions[tpl.versions.length - 1];
  const c = v?.content?.email;
  if (!c) throw Object.assign(new Error("Template has no email content"), { code: "no_content" });
  const sender = (await query("SELECT email,name FROM senders WHERE org_id=$1 AND status='verified' ORDER BY is_default DESC LIMIT 1", [n.org_id])).rows[0];
  const from = sender ? `${sender.name} <${sender.email}>` : config.sesFrom;
  const subject = renderText(c.subject ?? "", n.data), html = renderText(c.body, n.data);
  if (config.otpConsole && !process.env.AWS_PROFILE) { console.log(`[email:dev] to=${n.recipient_raw} subject=${subject}`); return { id: `dev_${newId("msg")}`, provider: "console" }; }
  if (!from) throw Object.assign(new Error("No verified sender. Add one under Channels → Email."), { code: "no_sender" });
  ses ??= new SESv2Client({ region: process.env.AWS_REGION });
  const r = await ses.send(new SendEmailCommand({
    FromEmailAddress: from, Destination: { ToAddresses: [n.recipient_raw] },
    Content: { Simple: { Subject: { Data: subject }, Body: { Html: { Data: html }, Text: { Data: html.replace(/<[^>]+>/g, " ") } } } },
  }));
  return { id: r.MessageId, provider: "aws_ses" };
}

/** Sends one notification and records the attempt, status and timeline. Safe to call again for retries. */
export async function deliver(id) {
  const n = (await query("SELECT * FROM notifications WHERE id=$1", [id])).rows[0];
  if (!n || ["cancelled", "delivered", "sent", "read"].includes(n.status)) return;
  const channel = n.channels[0] ?? "email";
  const attemptNo = (n.deliveries[0]?.attempts?.length ?? 0) + 1;
  const t0 = Date.now();
  let status = "sent", attempt, providerId = null, provider = channel === "email" ? "aws_ses" : "meta_cloud_api";
  try {
    if (channel !== "email") throw Object.assign(new Error(`${channel} sending is not configured yet`), { code: "channel_not_configured" });
    const tpl = await findTemplate(n.org_id, n.project_id, n.template_key);
    if (!tpl) throw Object.assign(new Error(`Template "${n.template_key}" not found`), { code: "template_not_found" });
    const r = await sendEmail(n, tpl);
    providerId = r.id; provider = r.provider;
    attempt = { id: newId("att"), attempt_no: attemptNo, provider, status: "success", error_code: null, error_message: null, latency_ms: Date.now() - t0, provider_response: { message_id: r.id }, at: now() };
  } catch (e) {
    status = "failed";
    attempt = { id: newId("att"), attempt_no: attemptNo, provider, status: "failed", error_code: e.code ?? e.name ?? "error", error_message: e.message, latency_ms: Date.now() - t0, provider_response: {}, at: now() };
  }
  const prev = n.deliveries[0]?.attempts ?? [];
  const deliveries = [{ id: n.deliveries[0]?.id ?? newId("dlv"), channel, provider, status, attempts: [...prev, attempt], provider_message_id: providerId }];
  const timeline = [...n.timeline, { type: status === "sent" ? "sent" : "attempt_failed", at: attempt.at, ...(attempt.error_code ? { detail: attempt.error_code } : {}) }, ...(status === "failed" ? [{ type: "failed", at: attempt.at }] : [])];
  await query("UPDATE notifications SET status=$2, deliveries=$3, timeline=$4, cancellable=false WHERE id=$1", [id, status, JSON.stringify(deliveries), JSON.stringify(timeline)]);
}

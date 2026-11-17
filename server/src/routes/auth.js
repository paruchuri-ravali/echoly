import { Hono } from "hono";
import { z } from "zod";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { query } from "../db/pool.js";
import { config } from "../config.js";
import { body } from "../lib/validate.js";
import { COOKIE } from "../middleware/session.js";
import { HttpError, notFound } from "../lib/errors.js";
import { sendOtpEmail } from "../lib/mailer.js";
import { normEmail, otpCode, randomToken, sha256 } from "../lib/util.js";

const r = new Hono();

async function startSession(c, userId) {
  const token = randomToken();
  await query("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2, now() + ($3 || ' hours')::interval)", [sha256(token), userId, String(config.sessionTtlHours)]);
  const sameSite = config.cookieSameSite;
  setCookie(c, COOKIE, token, {
    httpOnly: true, path: "/", sameSite, secure: config.isProd || sameSite === "None", maxAge: config.sessionTtlHours * 3600,
  });
}

r.post("/otp/request", body(z.object({ email: z.string().email() })), async (c) => {
  const email = normEmail(c.req.valid("json").email);
  // Same response whether or not the email is registered (no account enumeration).
  // Demo-org users sign in with the demo buttons only: never create or email codes for them.
  const user = (await query("SELECT u.id FROM users u JOIN orgs o ON o.id=u.org_id WHERE u.email=$1 AND o.slug<>'demo'", [email])).rows[0];
  const recent = (await query("SELECT count(*)::int n FROM otp_codes WHERE email=$1 AND created_at > now() - interval '1 hour'", [email])).rows[0].n;
  if (user && recent < 5) {
    const code = otpCode();
    await query("INSERT INTO otp_codes (email,code_hash,expires_at) VALUES ($1,$2, now() + interval '10 minutes')", [email, sha256(`${email}:${code}`)]);
    if (config.otpConsole) console.log(`[otp] ${email} -> ${code}`);
    else await sendOtpEmail(email, code).catch((e) => console.error("otp email failed", e.message));
  }
  return c.json({ ok: true });
});

r.post("/otp/verify", body(z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) })), async (c) => {
  const { email: raw, code } = c.req.valid("json");
  const email = normEmail(raw);
  const otp = (await query("SELECT id,code_hash,attempts FROM otp_codes WHERE email=$1 AND used=false AND expires_at>now() ORDER BY created_at DESC LIMIT 1", [email])).rows[0];
  const bad = new HttpError(401, "invalid_code", "Invalid or expired code");
  if (!otp || otp.attempts >= 5) throw bad;
  if (otp.code_hash !== sha256(`${email}:${code}`)) {
    await query("UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1", [otp.id]);
    throw bad;
  }
  await query("UPDATE otp_codes SET used=true WHERE id=$1", [otp.id]);
  const user = (await query("SELECT u.id FROM users u JOIN orgs o ON o.id=u.org_id WHERE u.email=$1 AND o.slug<>'demo'", [email])).rows[0];
  if (!user) throw bad;
  await startSession(c, user.id);
  return c.json({ ok: true });
});

// Dev only: the Login page's demo buttons. Disabled unless ENABLE_DEMO_LOGIN=true.
r.get("/config", (c) => c.json({ demo: config.demoMode || config.enableDemoLogin }));

r.post("/demo-login", body(z.object({ role: z.enum(["org_admin", "project_admin", "developer", "client", "viewer"]) })), async (c) => {
  if (!config.enableDemoLogin && !config.demoMode) throw notFound("Route");
  const { role } = c.req.valid("json");
  // In deployed demo mode the buttons only ever reach the isolated demo organization.
  const u = (await query(
    `SELECT m.user_id FROM memberships m JOIN users us ON us.id=m.user_id JOIN orgs o ON o.id=us.org_id
     WHERE m.role=$1 AND ($2::boolean = false OR o.slug='demo') ORDER BY m.created_at LIMIT 1`, [role, config.demoMode])).rows[0];
  if (!u) throw new HttpError(404, "not_found", `No seeded user with role ${role}. Run npm run seed.`);
  await startSession(c, u.user_id);
  return c.json({ ok: true });
});

r.post("/logout", async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await query("DELETE FROM sessions WHERE token_hash=$1", [sha256(token)]);
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

export default r;

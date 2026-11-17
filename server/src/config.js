const env = process.env;
const list = (v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(env.PORT ?? 8787),
  databaseUrl: env.DATABASE_URL ?? "postgres://notify:notify@localhost:5432/notify",
  corsOrigins: list(env.CORS_ORIGINS ?? "http://localhost:5173"),
  cookieSameSite: env.COOKIE_SAMESITE ?? "Lax",
  sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 168),
  enableDemoLogin: env.ENABLE_DEMO_LOGIN === "true",
  otpConsole: env.OTP_CONSOLE === "true",
  isProd: env.NODE_ENV === "production",
};

if (config.isProd && config.enableDemoLogin) throw new Error("ENABLE_DEMO_LOGIN must not be true in production");

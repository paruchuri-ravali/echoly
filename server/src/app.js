import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HttpError } from "./lib/errors.js";
import { config } from "./config.js";
import { requestId } from "./middleware/requestId.js";
import { session } from "./middleware/session.js";
import { query } from "./db/pool.js";
import auth from "./routes/auth.js";
import core from "./routes/core.js";
import projects from "./routes/projects.js";
import users from "./routes/users.js";
import auditRoutes from "./routes/audit.js";
import messaging, { internal as messagingInternal } from "./routes/messaging.js";
import platform from "./routes/platform.js";
import { v1auth } from "./middleware/apikey.js";

export const app = new Hono();

app.use(requestId);
app.use(logger());
app.use(cors({ origin: config.corsOrigins, credentials: true, allowHeaders: ["content-type", "authorization", "idempotency-key"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] }));

app.get("/healthz", (c) => c.json({ ok: true }));
app.get("/readyz", async (c) => { await query("SELECT 1"); return c.json({ ok: true }); });

// Public auth routes, then everything else under /internal requires a session.
app.route("/internal/auth", auth);
app.use("/internal/*", session);
app.route("/internal", core);
app.route("/internal", projects);
app.route("/internal", users);
app.route("/internal", auditRoutes);
app.route("/internal", messagingInternal);
app.route("/internal", platform);

// Public API (`/v1`): API key or session. The OpenAPI document is public.
app.get("/v1/openapi.json", (c) => c.json({
  openapi: "3.1.0", info: { title: "Echoly API", version: "0.1.0" },
  servers: [{ url: new URL(c.req.url).origin }],
  components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Project API key (nan_<env>_...)" } } }, security: [{ bearer: [] }],
  paths: {
    "/v1/notifications": { get: { summary: "List notifications" }, post: { summary: "Send a notification (Idempotency-Key header supported)" } },
    "/v1/notifications/{id}": { get: { summary: "Get one notification with attempts and timeline" } },
    "/v1/notifications/{id}/retry": { post: { summary: "Retry a failed notification" } },
    "/v1/notifications/{id}/cancel": { post: { summary: "Cancel a queued or scheduled notification" } },
    "/v1/templates": { get: { summary: "List templates" }, post: { summary: "Create a template" } },
    "/v1/schedules": { get: { summary: "List schedules" }, post: { summary: "Schedule a one-off send" } },
    "/v1/webhooks": { get: { summary: "List webhook subscriptions" } },
  },
}));
app.use("/v1/*", v1auth);
app.route("/v1", messaging);

const err = (c, status, code, message) => c.json({ error: { code, message, request_id: c.get("requestId") } }, status);
app.notFound((c) => err(c, 404, "not_found", "Route not found"));
app.onError((e, c) => {
  if (e instanceof HttpError) return err(c, e.status, e.code, e.message);
  console.error(c.get("requestId"), e);
  return err(c, 500, "internal_error", "Something went wrong");
});

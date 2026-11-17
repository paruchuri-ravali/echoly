import "./aws-bootstrap.js"; // must be first: may set DATABASE_URL from Secrets Manager
const { serve } = await import("@hono/node-server");
const { app } = await import("./app.js");
const { config } = await import("./config.js");
const { pool } = await import("./db/pool.js");

const server = serve({ fetch: app.fetch, port: config.port }, (i) => console.log(`API listening on :${i.port}`));
const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

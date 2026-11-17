import { pool, tx } from "./pool.js";

// Wipes generated demo content (not users/orgs/projects) so `npm run seed` regenerates it.
const slug = process.env.SEED_ORG_SLUG ?? "echoly";
await tx(async (db) => {
  const org = (await db.query("SELECT id FROM orgs WHERE slug=$1", [slug])).rows[0]?.id;
  if (!org) { console.log(`No org "${slug}"`); return; }
  for (const t of ["notifications", "schedules", "workflows", "webhooks", "templates", "providers", "senders", "audit_logs"])
    await db.query(`DELETE FROM ${t} WHERE org_id=$1`, [org]);
  await db.query("DELETE FROM api_keys WHERE environment_id IN (SELECT e.id FROM environments e JOIN projects p ON p.id=e.project_id WHERE p.org_id=$1)", [org]);
  await db.query("DELETE FROM brandings WHERE project_id IN (SELECT id FROM projects WHERE org_id=$1)", [org]);
  console.log(`Cleared demo content for org "${slug}"`);
});
await pool.end();

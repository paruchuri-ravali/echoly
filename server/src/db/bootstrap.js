import { query, tx } from "./pool.js";
import { newId } from "../lib/util.js";

/** Idempotent: creates the first org + main admin if the database has no users yet. */
export async function bootstrapAdmin(email, name = "Main Admin") {
  if (!email) return;
  email = email.trim().toLowerCase();
  if ((await query("SELECT 1 FROM users LIMIT 1")).rowCount) return;
  await tx(async (db) => {
    const org = newId("org"), usr = newId("usr");
    await db.query("INSERT INTO orgs (id,name,slug) VALUES ($1,'Echoly','echoly')", [org]);
    await db.query("INSERT INTO users (id,org_id,email,name) VALUES ($1,$2,$3,$4)", [usr, org, email, name]);
    await db.query("INSERT INTO memberships (id,user_id,project_id,role) VALUES ($1,$2,NULL,'org_admin')", [newId("mem"), usr]);
  });
  console.log(`Bootstrapped main admin ${email}`);
}

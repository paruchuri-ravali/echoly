import { query, tx } from "./pool.js";
import { newId } from "../lib/util.js";
import { seedDemoData } from "./demo-data.js";

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

/** Isolated sample organization for the public demo buttons. Separate from the real org. */
export async function ensureDemoOrg() {
  const existing = (await query("SELECT id FROM orgs WHERE slug='demo'")).rows[0];
  if (existing) { await tx((db) => seedDemoData(db, existing.id)); return; } // fills in data on older demo orgs; no-op if present
  await tx(async (db) => {
    const org = newId("org"), prj = newId("prj");
    await db.query("INSERT INTO orgs (id,name,slug) VALUES ($1,'Echoly Demo','demo')", [org]);
    await db.query("INSERT INTO projects (id,org_id,name,slug,description) VALUES ($1,$2,'Demo Project','demo-project','Sample project for the public demo')", [prj, org]);
    for (const k of ["dev", "staging", "prod"]) await db.query("INSERT INTO environments (id,project_id,kind) VALUES ($1,$2,$3)", [newId("env"), prj, k]);
    const people = [
      ["Demo Main Admin", "admin@demo.echoly.local", "org_admin", null],
      ["Demo Manager", "manager@demo.echoly.local", "project_admin", prj],
      ["Demo Developer", "developer@demo.echoly.local", "developer", prj],
      ["Demo Client", "client@demo.echoly.local", "client", prj],
    ];
    for (const [name, email, role, proj] of people) {
      const usr = newId("usr");
      await db.query("INSERT INTO users (id,org_id,email,name) VALUES ($1,$2,$3,$4)", [usr, org, email, name]);
      await db.query("INSERT INTO memberships (id,user_id,project_id,role) VALUES ($1,$2,$3,$4)", [newId("mem"), usr, proj, role]);
    }
    await seedDemoData(db, org);
  });
  console.log("Created demo organization");
}

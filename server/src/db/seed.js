import { pool, tx } from "./pool.js";
import { migrate } from "./migrate.js";
import { newId, slugify } from "../lib/util.js";

await migrate();
const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
const adminName = process.env.SEED_ADMIN_NAME ?? "Main Admin";

await tx(async (db) => {
  const org = (await db.query("SELECT id FROM orgs LIMIT 1")).rows[0]?.id ?? newId("org");
  await db.query("INSERT INTO orgs (id,name,slug) VALUES ($1,'Orotron','orotron') ON CONFLICT DO NOTHING", [org]);

  let project = (await db.query("SELECT id FROM projects WHERE org_id=$1 LIMIT 1", [org])).rows[0]?.id;
  if (!project) {
    project = newId("prj");
    await db.query("INSERT INTO projects (id,org_id,name,slug,description) VALUES ($1,$2,'Demo Project',$3,'Seeded demo project')", [project, org, slugify("Demo Project")]);
    for (const k of ["dev", "staging", "prod"]) await db.query("INSERT INTO environments (id,project_id,kind) VALUES ($1,$2,$3)", [newId("env"), project, k]);
  }

  const people = [
    [adminEmail, adminName, "org_admin", null],
    ["manager@example.com", "Demo Manager", "project_admin", project],
    ["developer@example.com", "Demo Developer", "developer", project],
    ["client@example.com", "Demo Client", "client", project],
  ];
  for (const [email, name, role, proj] of people) {
    const u = (await db.query("INSERT INTO users (id,org_id,email,name) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO UPDATE SET name=users.name RETURNING id", [newId("usr"), org, email, name])).rows[0].id;
    await db.query("INSERT INTO memberships (id,user_id,project_id,role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [newId("mem"), u, proj, role]);
  }
});
console.log(`Seeded. Sign in as ${adminEmail} (OTP is printed to the server console when OTP_CONSOLE=true).`);
await pool.end();

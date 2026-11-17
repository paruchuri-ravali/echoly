# Echoly — API server

Node.js (ESM, plain JavaScript) · Hono · PostgreSQL · built to run on AWS (ECS Fargate + RDS).

## Run locally
    docker run -d --name notify-pg -e POSTGRES_USER=notify -e POSTGRES_PASSWORD=notify -e POSTGRES_DB=notify -p 5432:5432 postgres:16
    # (or: docker compose up -d)
    cp .env.example .env
    npm install
    npm run seed        # migrates + creates demo org, project and users
    npm run dev         # http://localhost:8787

Point the dashboard at it: in `web/.env.development` set `VITE_USE_MOCK=false`.
OTP codes are printed to the server console while `OTP_CONSOLE=true`.

## AWS
- `AWS_PROFILE` / `AWS_REGION` select the named profile for the SDK (also used by the CLI/CDK for deploys).
- Set `DB_SECRET_ARN` to read RDS credentials from Secrets Manager instead of `DATABASE_URL`.
- On ECS the task role supplies credentials; no profile is needed there.

## Done in this slice
Auth (OTP + cookie sessions), `/internal/me|orgs|permissions`, projects, environments, API keys,
users/members, audit log. RBAC and project isolation are enforced server-side.

## Next
Notifications + SQS worker + SES, templates, schedules, channels/providers, webhooks, logs, analytics,
branding, then `infra/` (CDK).

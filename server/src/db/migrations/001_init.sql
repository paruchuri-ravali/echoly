CREATE TABLE orgs (
  id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES orgs(id), email text NOT NULL UNIQUE, name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE projects (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES orgs(id), name text NOT NULL, slug text NOT NULL,
  description text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  daily_quota integer NOT NULL DEFAULT 10000, rate_per_minute integer NOT NULL DEFAULT 120,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (org_id, slug)
);
CREATE TABLE environments (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('dev','staging','prod')), UNIQUE (project_id, kind)
);
-- project_id NULL = organization-wide membership (org_admin)
CREATE TABLE memberships (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id text REFERENCES projects(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('org_admin','project_admin','developer','client','viewer')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX memberships_unique ON memberships (user_id, COALESCE(project_id, ''));
CREATE TABLE api_keys (
  id text PRIMARY KEY, environment_id text NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name text NOT NULL, prefix text NOT NULL UNIQUE, secret_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','rotating','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE otp_codes (
  id bigserial PRIMARY KEY, email text NOT NULL, code_hash text NOT NULL, expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0, used boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_email_idx ON otp_codes (email, created_at DESC);
CREATE TABLE org_settings (
  org_id text NOT NULL REFERENCES orgs(id), key text NOT NULL, value jsonb NOT NULL, PRIMARY KEY (org_id, key)
);
CREATE TABLE audit_logs (
  id text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), org_id text NOT NULL,
  actor text NOT NULL, actor_name text NOT NULL, actor_role text NOT NULL,
  action text NOT NULL, target text NOT NULL, project_id text, project_name text, ip text NOT NULL DEFAULT '',
  changes jsonb
);
CREATE INDEX audit_at_idx ON audit_logs (org_id, at DESC);

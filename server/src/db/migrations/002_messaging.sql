CREATE TABLE templates (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES orgs(id), key text NOT NULL, name text NOT NULL,
  scope text NOT NULL DEFAULT 'project' CHECK (scope IN ('project','organization')),
  project_id text REFERENCES projects(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  channels jsonb NOT NULL DEFAULT '[]', latest_version integer NOT NULL DEFAULT 1, sample_data jsonb NOT NULL DEFAULT '{}',
  versions jsonb NOT NULL DEFAULT '[]', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX templates_key_scope ON templates (org_id, key, COALESCE(project_id, ''));
CREATE TABLE brandings (project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, data jsonb NOT NULL);
CREATE TABLE providers (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES orgs(id), channel text NOT NULL, provider text NOT NULL, name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true, priority integer NOT NULL DEFAULT 1, secret_hint text NOT NULL DEFAULT '',
  health text NOT NULL DEFAULT 'unknown', config jsonb NOT NULL DEFAULT '{}', secrets_enc text, last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE senders (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES orgs(id), email text NOT NULL, name text NOT NULL, provider text NOT NULL DEFAULT 'aws_ses',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','failed')), is_default boolean NOT NULL DEFAULT false,
  message text, created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz, UNIQUE (org_id, email)
);
CREATE TABLE notifications (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES orgs(id), project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  env text NOT NULL DEFAULT 'dev', environment_id text NOT NULL, category text NOT NULL DEFAULT 'transactional',
  priority text NOT NULL DEFAULT 'normal', status text NOT NULL DEFAULT 'queued', channels jsonb NOT NULL DEFAULT '["email"]',
  recipient text NOT NULL, recipient_raw text NOT NULL, template_key text NOT NULL, data jsonb NOT NULL DEFAULT '{}',
  idempotency_key text, send_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  deliveries jsonb NOT NULL DEFAULT '[]', timeline jsonb NOT NULL DEFAULT '[]', cancellable boolean NOT NULL DEFAULT true
);
CREATE INDEX notifications_org_created ON notifications (org_id, created_at DESC);
CREATE UNIQUE INDEX notifications_idem ON notifications (project_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE schedules (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES orgs(id), project_id text REFERENCES projects(id) ON DELETE CASCADE,
  template_key text NOT NULL, recipient text NOT NULL, channel text NOT NULL DEFAULT 'email', timezone text NOT NULL DEFAULT 'UTC',
  kind text NOT NULL DEFAULT 'one_off', rule text NOT NULL DEFAULT 'once', next_run_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled', last_run_status text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workflows (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES orgs(id), name text NOT NULL, trigger_event text NOT NULL,
  active boolean NOT NULL DEFAULT false, category text NOT NULL DEFAULT 'transactional', conditions text NOT NULL DEFAULT '',
  steps jsonb NOT NULL DEFAULT '[]', version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE webhooks (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES orgs(id), url text NOT NULL, events jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'active', secret_hint text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);

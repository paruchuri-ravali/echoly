// Resolves DATABASE_URL from AWS Secrets Manager when DB_SECRET_ARN is set (RDS-managed secret format).
// Credentials come from the normal AWS chain, so AWS_PROFILE (local) or the task role (ECS) just works.
// This must run before ./config.js is imported.
if (process.env.DB_SECRET_ARN) {
  const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
  const sm = new SecretsManagerClient({ region: process.env.AWS_REGION });
  const { SecretString } = await sm.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
  const s = JSON.parse(SecretString);
  const u = encodeURIComponent(s.username);
  const p = encodeURIComponent(s.password);
  const ssl = process.env.DB_SSL === "false" ? "" : "?sslmode=no-verify";
  process.env.DATABASE_URL = `postgres://${u}:${p}@${s.host}:${s.port ?? 5432}/${s.dbname ?? "echoly"}${ssl}`;
}

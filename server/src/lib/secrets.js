import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

// AES-256-GCM for provider credentials. Secrets are write-only: the API never returns them.
const key = () => {
  const raw = process.env.SECRETS_KEY ?? (config.isProd ? "" : "dev-only-secrets-key");
  if (!raw) throw new Error("SECRETS_KEY is required in production");
  return createHash("sha256").update(raw).digest();
};
export function encrypt(obj) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
export function decrypt(b64) {
  const buf = Buffer.from(b64, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
}

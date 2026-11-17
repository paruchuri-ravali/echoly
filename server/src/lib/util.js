import { createHash, randomBytes, randomInt } from "node:crypto";

export const newId = (prefix) => `${prefix}_${randomBytes(8).toString("hex")}`;
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Offset-based cursor pagination: { data, next_cursor, total } */
export function pageParams(q) {
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const offset = Math.max(Number(q.cursor) || 0, 0);
  return { limit, offset };
}
export function pageResult(rows, total, { limit, offset }) {
  const next = offset + rows.length;
  return { data: rows, next_cursor: next < total ? String(next) : null, total };
}

export const normEmail = (e) => String(e ?? "").trim().toLowerCase();
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

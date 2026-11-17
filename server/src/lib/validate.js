import { zValidator } from "@hono/zod-validator";
import { invalid } from "./errors.js";

export const body = (schema) =>
  zValidator("json", schema, (res) => {
    if (!res.success) throw invalid(res.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  });

import { randomBytes } from "node:crypto";

export const requestId = async (c, next) => {
  const id = `req_${randomBytes(6).toString("hex")}`;
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
};

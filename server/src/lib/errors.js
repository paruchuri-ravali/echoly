export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const notFound = (what) => new HttpError(404, "not_found", `${what} not found`);
export const forbidden = (msg = "You do not have permission to do this") => new HttpError(403, "forbidden", msg);
export const invalid = (msg) => new HttpError(422, "invalid_request", msg);
export const conflict = (msg) => new HttpError(409, "conflict", msg);

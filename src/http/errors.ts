/**
 * Application errors.
 *
 * Every failure the API reports deliberately goes through one of these, so
 * that the shape of an error response is decided in one place rather than
 * improvised at each throw site.
 */

export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: FieldErrors;

  constructor(status: number, code: string, message: string, fieldErrors?: FieldErrors) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    if (fieldErrors) this.fieldErrors = fieldErrors;
  }
}

export const badRequest = (message: string, fieldErrors?: FieldErrors) =>
  new AppError(400, "bad_request", message, fieldErrors);

export const validationFailed = (fieldErrors: FieldErrors, message = "Please correct the highlighted fields.") =>
  new AppError(422, "validation_failed", message, fieldErrors);

export const unauthorised = (message = "You must be signed in to do that.") =>
  new AppError(401, "unauthorised", message);

export const forbidden = (message = "You do not have permission to do that.") =>
  new AppError(403, "forbidden", message);

export const notFound = (message = "Not found.") => new AppError(404, "not_found", message);

/**
 * The state changed under the caller — a seat was taken, a booking was already
 * cancelled. Distinguished from 400 because the request was well-formed and
 * would have succeeded a moment earlier; the client should re-read and retry
 * rather than correct anything.
 */
export const conflict = (message: string) => new AppError(409, "conflict", message);

export const paymentFailed = (message: string) => new AppError(402, "payment_failed", message);

export const tooManyRequests = (message = "Too many attempts. Please wait and try again.") =>
  new AppError(429, "too_many_requests", message);

export const serverError = (message = "Something went wrong on our side.") =>
  new AppError(500, "server_error", message);

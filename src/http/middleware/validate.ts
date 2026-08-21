/**
 * Request validation.
 *
 * Every request body, query and route parameter is parsed by a Zod schema
 * before a handler sees it. The handler therefore receives a value it can
 * trust, and never has to ask whether a field is present or the right type.
 */

import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodSchema } from "zod";
import { validationFailed } from "../errors.js";

type Source = "body" | "query" | "params";

/** Zod issues → the flat field-to-message map the frontend already renders. */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    // First message per field wins; a cascade of messages on one input is
    // noise, and the first is invariably the one worth reading.
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

export function validate<T>(schema: ZodSchema<T>, source: Source = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      throw validationFailed(toFieldErrors(result.error));
    }

    /* Express 5 makes req.query a getter, so it cannot be reassigned. The
       parsed value is parked alongside instead, and handlers read it from
       there. */
    if (source === "query") {
      (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data;
    } else {
      req[source] = result.data as never;
    }

    next();
  };
}

/** Typed accessor for a query parsed by {@link validate}. */
export function query<T>(req: Request): T {
  return (req as Request & { validatedQuery: T }).validatedQuery;
}

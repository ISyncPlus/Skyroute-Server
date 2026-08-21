/**
 * The error boundary.
 *
 * One place decides what a client is told when something fails, which is the
 * only way to be sure an internal detail never leaks out of an unusual code
 * path nobody thought about.
 */

import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors.js";
import { logger } from "../../config/logger.js";
import { env } from "../../config/env.js";

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
  };
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: "not_found", message: `No route matches ${req.method} ${req.path}.` },
  } satisfies ErrorBody);
}

/** Turn a Prisma failure into something a human can act on. */
function fromPrisma(error: Prisma.PrismaClientKnownRequestError): AppError | null {
  switch (error.code) {
    case "P2002":
      return new AppError(409, "conflict", "That record already exists.");
    case "P2025":
      return new AppError(404, "not_found", "That record could not be found.");
    case "P2003":
      return new AppError(
        409,
        "conflict",
        "That record is referenced by something else and cannot be changed.",
      );
    case "P2034":
      return new AppError(
        409,
        "conflict",
        "The system was busy with a conflicting change. Please try again.",
      );
    default:
      return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let appError: AppError;

  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    appError = fromPrisma(error) ?? new AppError(500, "server_error", "A database error occurred.");
  } else if (error instanceof SyntaxError && "body" in error) {
    // Thrown by express.json() on malformed input.
    appError = new AppError(400, "bad_request", "The request body is not valid JSON.");
  } else {
    appError = new AppError(500, "server_error", "Something went wrong on our side.");
  }

  /* A 5xx is our fault and gets the stack. A 4xx is the caller's and gets a
     single line, or the log fills with noise from ordinary validation. */
  if (appError.status >= 500) {
    logger.error(
      { err: error, method: req.method, path: req.path, requestId: req.id },
      appError.message,
    );
  } else {
    logger.debug({ method: req.method, path: req.path, code: appError.code }, appError.message);
  }

  const body: ErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.fieldErrors ? { fieldErrors: appError.fieldErrors } : {}),
    },
  };

  // The stack is a development convenience and must never ship to production,
  // where it would hand an attacker a map of the codebase.
  if (!env.isProduction && appError.status >= 500 && error instanceof Error) {
    (body.error as Record<string, unknown>).stack = error.stack;
  }

  res.status(appError.status).json(body);
}

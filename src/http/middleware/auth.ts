/**
 * Authentication middleware.
 *
 * These attach the caller to the request. They do NOT decide what the caller
 * may do with a particular record — that lives in the services, beside the
 * work. A route guard can only answer "is this someone"; only the service can
 * answer "is this booking theirs".
 */

import type { NextFunction, Request, Response } from "express";
import { readSessionToken } from "../../lib/session.js";
import { resolveSession } from "../../services/auth.service.js";
import { forbidden, unauthorised } from "../errors.js";
import type { SessionUser } from "../../domain/types.js";

/**
 * Passport already declares `Express.User` as an empty interface and types
 * `req.user` as `Express.User | undefined`. Redeclaring `req.user` here would
 * collide with that declaration; filling in `Express.User` instead merges with
 * it, so `req.user` becomes our session principal everywhere at once.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends SessionUser {}

    interface Request {
      /** The raw token this request authenticated with, so it can be revoked. */
      sessionToken?: string | undefined;
    }
  }
}

/**
 * Populate req.user when a valid session is present, and carry on regardless.
 *
 * Used on routes that behave differently for a signed-in user but do not
 * require one — booking, above all, which must work for a guest.
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = readSessionToken(req);
  if (!token) return next();

  const user = await resolveSession(token);
  if (user) {
    req.user = user;
    req.sessionToken = token;
  }
  next();
}

/** Refuse anonymous callers. */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = readSessionToken(req);
  if (!token) throw unauthorised();

  const user = await resolveSession(token);
  if (!user) throw unauthorised("Your session has expired. Please sign in again.");

  req.user = user;
  req.sessionToken = token;
  next();
}

/** Refuse anyone who is not an administrator. */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      throw forbidden("Administrator privileges are required for this action.");
    }
    next();
  });
}

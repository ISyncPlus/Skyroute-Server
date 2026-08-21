/**
 * Sessions.
 *
 * An opaque random token, delivered in an HTTP-only cookie, with only its
 * SHA-256 digest kept in the database.
 *
 * Opaque rather than a JWT, deliberately. A JWT cannot be revoked before it
 * expires without keeping server-side state anyway — at which point the JWT is
 * doing nothing a database row was not already doing, while adding an
 * algorithm-confusion attack surface. Signing out of a stolen session has to
 * actually work, so the token is a lookup key and revocation is a DELETE.
 *
 * Only the digest is stored, so a leaked database backup contains nothing that
 * can be replayed as a login.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Response } from "express";
import { env } from "../config/env.js";

export const SESSION_COOKIE = "skyroute_session";

/** 256 bits of entropy: not guessable, and short enough for a cookie. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Compare two digests without leaking, via timing, where they first differ. */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function cookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true, // JavaScript cannot read it, so XSS cannot steal it.
    secure: env.COOKIE_SECURE,
    // "none" with secure=true allows cross-origin requests (e.g., localhost or Vercel frontend calling Render backend).
    // "lax" is used in non-secure local dev.
    sameSite: env.COOKIE_SECURE ? "none" : "lax",
    path: "/",
    maxAge: maxAgeMs,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, cookieOptions(env.sessionTtlMs));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}

/**
 * The bearer token on a request, from the cookie or from an Authorization
 * header. The cookie serves the web app; the header serves anything that is
 * not a browser, such as the marker running curl.
 */
export function readSessionToken(req: {
  cookies?: Record<string, unknown>;
  headers: Record<string, unknown>;
}): string | null {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (typeof cookie === "string" && cookie.length > 0) return cookie;

  const header = req.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token.length > 0) return token;
  }

  return null;
}

export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + env.sessionTtlMs);
}

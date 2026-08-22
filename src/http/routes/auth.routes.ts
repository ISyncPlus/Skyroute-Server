/** Registration, sign-in, sign-out, profile and OAuth. */

import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import type { User } from "@prisma/client";
import { env } from "../../config/env.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { clearSessionCookie, setSessionCookie } from "../../lib/session.js";
import { enabledProviders, passport, type Provider } from "../../lib/oauth.js";
import {
  changePassword,
  getProfile,
  issueSession,
  listLinkedProviders,
  login,
  register,
  revokeAllSessions,
  revokeSession,
  unlinkProvider,
  updateProfile,
} from "../../services/auth.service.js";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from "../schemas.js";
import { badRequest, notFound } from "../errors.js";

export const authRoutes = Router();

/**
 * Credential endpoints are rate limited per IP.
 *
 * Without this, a password of any strength is only as good as how fast an
 * attacker can guess, and scrypt's cost protects the stored hash rather than
 * the login form.
 */
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isProduction ? 10 : 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: {
      code: "too_many_requests",
      message: "Too many attempts. Please wait fifteen minutes and try again.",
    },
  },
});

function meta(req: Request) {
  return { userAgent: req.get("user-agent") ?? undefined, ip: req.ip ?? undefined };
}

/* ------------------------------------------------------------------ */
/* Password                                                            */
/* ------------------------------------------------------------------ */

authRoutes.post(
  "/register",
  credentialLimiter,
  validate(registerSchema),
  async (req: Request, res: Response) => {
    const result = await register(req.body, meta(req));
    setSessionCookie(res, result.token);
    res.status(201).json({
      user: result.user,
      // Returned so that non-browser clients can use the Authorization header.
      // A browser should ignore it and rely on the cookie it cannot read.
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
    });
  },
);

authRoutes.post(
  "/login",
  credentialLimiter,
  validate(loginSchema),
  async (req: Request, res: Response) => {
    const result = await login(req.body.email, req.body.password, meta(req));
    setSessionCookie(res, result.token);
    res.json({
      user: result.user,
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
    });
  },
);

authRoutes.post("/logout", async (req: Request, res: Response) => {
  const token = req.sessionToken ?? req.cookies?.skyroute_session;
  if (typeof token === "string") await revokeSession(token);
  clearSessionCookie(res);
  res.status(204).end();
});

authRoutes.post("/logout-all", requireAuth, async (req: Request, res: Response) => {
  const count = await revokeAllSessions(req.user!.id);
  clearSessionCookie(res);
  res.json({ sessionsRevoked: count });
});

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

/** Who am I? Returns null rather than 401 so the frontend can call it freely. */
authRoutes.get("/me", async (req: Request, res: Response) => {
  const token = req.sessionToken;
  if (!req.user || !token) return res.json({ user: null });

  const [profile, providers] = await Promise.all([
    getProfile(req.user.id),
    listLinkedProviders(req.user.id),
  ]);

  return res.json({ user: profile, linkedProviders: providers });
});

authRoutes.patch(
  "/me",
  requireAuth,
  validate(updateProfileSchema),
  async (req: Request, res: Response) => {
    res.json({ user: await updateProfile(req.user!.id, req.body) });
  },
);

authRoutes.post(
  "/change-password",
  requireAuth,
  credentialLimiter,
  validate(changePasswordSchema),
  async (req: Request, res: Response) => {
    await changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
    // Every session died with the password, including this one.
    clearSessionCookie(res);
    res.json({ message: "Password changed. Please sign in again." });
  },
);

/* ------------------------------------------------------------------ */
/* OAuth                                                               */
/* ------------------------------------------------------------------ */

authRoutes.get("/oauth/providers", (_req: Request, res: Response) => {
  res.json({ providers: enabledProviders });
});

function assertEnabled(provider: string): asserts provider is Provider {
  if (!enabledProviders.includes(provider as Provider)) {
    throw notFound(`Sign-in with ${provider} is not configured on this server.`);
  }
}

/** Where to send the browser once the handshake is done. */
function redirectTarget(status: "success" | "error", detail?: string): string {
  const base = env.webOrigins[0] ?? "/";
  const url = new URL("/login", base);
  url.searchParams.set("oauth", status);
  if (detail) url.searchParams.set("reason", detail);
  return url.toString();
}

authRoutes.get("/oauth/:provider", (req: Request, res: Response, next) => {
  const { provider } = req.params as { provider: string };
  assertEnabled(provider);

  passport.authenticate(provider, {
    session: false,
    scope: provider === "google" ? ["profile", "email"] : ["user:email"],
  })(req, res, next);
});

authRoutes.get("/oauth/:provider/callback", (req: Request, res: Response, next) => {
  const { provider } = req.params as { provider: string };
  assertEnabled(provider);

  passport.authenticate(
    provider,
    { session: false },
    async (error: unknown, user: User | false) => {
      /* A failure here is shown to a human in a browser, not to a program, so
         it redirects to the web app with a reason rather than returning JSON
         the user would see as raw text. */
      if (error || !user) {
        const reason =
          error instanceof Error ? error.message : "We could not complete that sign-in.";
        return res.redirect(redirectTarget("error", reason));
      }

      try {
        const result = await issueSession(user, meta(req));
        setSessionCookie(res, result.token);
        return res.redirect(redirectTarget("success"));
      } catch {
        return res.redirect(redirectTarget("error", "Your session could not be created."));
      }
    },
  )(req, res, next);
});

authRoutes.delete("/oauth/:provider", requireAuth, async (req: Request, res: Response) => {
  const { provider } = req.params as { provider: string };
  if (!provider) throw badRequest("Name the provider to unlink.");

  await unlinkProvider(req.user!.id, provider);
  res.json({ linkedProviders: await listLinkedProviders(req.user!.id) });
});

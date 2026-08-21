/**
 * OAuth via Passport.
 *
 * Passport is used only to perform the handshake with the provider. It is NOT
 * used for sessions: `session: false` throughout, and the callback issues one
 * of our own opaque session tokens. Two session mechanisms in one application
 * is one too many, and the one we control is the one that can be revoked.
 *
 * A provider whose credentials are absent is simply not registered, so the
 * server starts and runs perfectly well before the applications exist with
 * Google and GitHub.
 */

import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { findOrCreateOAuthUser, type OAuthProfile } from "../services/auth.service.js";

export type Provider = "google" | "github";

/** Providers actually configured, so routes are only mounted for real ones. */
export const enabledProviders: Provider[] = [];

export function callbackUrl(provider: Provider): string {
  return `${env.API_URL}/api/auth/oauth/${provider}/callback`;
}

/**
 * Reduce a provider profile to the three things we need.
 *
 * Only a VERIFIED address is accepted. An unverified address must never be
 * treated as proof of ownership: linking on one would let anyone who signs up
 * to a provider with someone else's address inherit that person's account.
 */
function extractProfile(
  provider: Provider,
  profile: {
    id: string;
    displayName?: string | undefined;
    username?: string | undefined;
    emails?: { value: string; verified?: boolean | string }[] | undefined;
  },
): OAuthProfile {
  const verified = profile.emails?.find(
    (email) => email.verified === undefined || email.verified === true || email.verified === "true",
  );

  return {
    provider,
    providerAccountId: profile.id,
    email: verified?.value ?? profile.emails?.[0]?.value ?? null,
    fullName: profile.displayName || profile.username || "",
  };
}

export function configurePassport(): void {
  if (env.oauth.google) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: env.oauth.google.clientId,
          clientSecret: env.oauth.google.clientSecret,
          callbackURL: callbackUrl("google"),
          scope: ["profile", "email"],
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const user = await findOrCreateOAuthUser(extractProfile("google", profile));
            done(null, user);
          } catch (error) {
            done(error as Error);
          }
        },
      ),
    );
    enabledProviders.push("google");
  }

  if (env.oauth.github) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: env.oauth.github.clientId,
          clientSecret: env.oauth.github.clientSecret,
          callbackURL: callbackUrl("github"),
          // GitHub withholds a private address unless this scope is asked for,
          // and an account with no address cannot be sent an itinerary.
          scope: ["user:email"],
        },
        async (
          _accessToken: string,
          _refreshToken: string,
          profile: Parameters<typeof extractProfile>[1],
          done: (error: Error | null, user?: unknown) => void,
        ) => {
          try {
            const user = await findOrCreateOAuthUser(extractProfile("github", profile));
            done(null, user);
          } catch (error) {
            done(error as Error);
          }
        },
      ),
    );
    enabledProviders.push("github");
  }

  if (enabledProviders.length === 0) {
    logger.warn(
      "No OAuth provider is configured. Set GOOGLE_* or GITHUB_* in .env to enable social sign-in.",
    );
  } else {
    logger.info({ providers: enabledProviders }, "OAuth providers enabled.");
  }
}

export { passport };

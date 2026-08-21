/**
 * Accounts and sessions.
 *
 * The rule that shapes this module: authorisation is enforced where the work
 * happens, never where the button is. The browser build could only hide a
 * control; here, refusing the operation is the control.
 */

import type { Prisma, User } from "@prisma/client";
import { prisma } from "../db/client.js";
import { hashPassword, needsRehash, verifyPassword } from "../lib/password.js";
import {
  generateSessionToken,
  hashSessionToken,
  sessionExpiry,
} from "../lib/session.js";
import { toPublicUser, toSessionUser, type PublicUser } from "./mappers.js";
import { badRequest, conflict, unauthorised, validationFailed } from "../http/errors.js";
import { validatePassword, validateRegistration } from "../domain/validation.js";
import { sanitiseText } from "../domain/validation.js";
import type { SessionUser } from "../domain/types.js";

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

export interface RegisterInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

export interface AuthResult {
  user: SessionUser;
  token: string;
  expiresAt: Date;
}

/* ------------------------------------------------------------------ */
/* Registration and sign-in                                            */
/* ------------------------------------------------------------------ */

export async function register(input: RegisterInput, meta: SessionMeta = {}): Promise<AuthResult> {
  const check = validateRegistration(input);
  if (!check.valid) throw validationFailed(check.errors);

  const email = normaliseEmail(input.email);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw conflict("An account already exists with that email address.");
  }

  const user = await prisma.user.create({
    data: {
      fullName: sanitiseText(input.fullName, 100),
      email,
      phone: sanitiseText(input.phone, 20),
      passwordHash: await hashPassword(input.password),
      role: "customer",
    },
  });

  return issueSession(user, meta);
}

/**
 * Sign in with a password.
 *
 * Both failure modes — no such account, and wrong password — return the same
 * message, because differing messages turn the login form into an oracle that
 * confirms which email addresses are registered.
 *
 * The work is also kept symmetric: an unknown email still pays the cost of a
 * hash verification against a dummy record, so response time does not quietly
 * leak what the message refuses to say.
 */
const DUMMY_HASH =
  "scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

export async function login(
  emailInput: string,
  password: string,
  meta: SessionMeta = {},
): Promise<AuthResult> {
  const email = normaliseEmail(emailInput ?? "");
  const user = await prisma.user.findUnique({ where: { email } });

  const matches = await verifyPassword(password ?? "", user?.passwordHash ?? DUMMY_HASH);

  if (!user || !matches) {
    throw unauthorised("Email address or password is incorrect.");
  }

  // Parameters get raised over time; upgrade the stored hash quietly on the
  // one occasion we legitimately hold the plaintext.
  if (needsRehash(user.passwordHash)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
  }

  return issueSession(user, meta);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorised();

  // An account created through Google has no password to confirm. Setting one
  // is a different operation from changing one, and is not offered here.
  if (!user.passwordHash) {
    throw badRequest(
      "This account signs in with a connected provider and has no password to change.",
    );
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw validationFailed({ currentPassword: "That is not your current password." });
  }

  const strength = validatePassword(newPassword);
  if (!strength.valid) throw validationFailed(strength.errors);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    }),
    // Changing a password is what you do when you fear someone else has it, so
    // every other session must die with it.
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export interface SessionMeta {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export async function issueSession(user: User, meta: SessionMeta = {}): Promise<AuthResult> {
  const token = generateSessionToken();
  const expiresAt = sessionExpiry();

  await prisma.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId: user.id,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 250) ?? null,
      ip: meta.ip?.slice(0, 60) ?? null,
    },
  });

  return { user: toSessionUser(user), token, expiresAt };
}

/**
 * Resolve a token to its account, or null.
 *
 * An expired row is deleted on sight rather than merely ignored, so the table
 * cleans itself up under normal traffic instead of growing without bound.
 */
export async function resolveSession(token: string): Promise<SessionUser | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  return toSessionUser(session.user);
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session
    .delete({ where: { tokenHash: hashSessionToken(token) } })
    .catch(() => undefined); // Already gone is the desired end state.
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } });
  return count;
}

/** Housekeeping for a scheduled job; not required for correctness. */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return count;
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export async function getProfile(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorised();
  return toPublicUser(user);
}

export async function updateProfile(
  userId: string,
  changes: { fullName?: string; phone?: string },
): Promise<PublicUser> {
  const data: Prisma.UserUpdateInput = {};

  if (changes.fullName !== undefined) {
    const fullName = sanitiseText(changes.fullName, 100);
    if (fullName.trim().split(/\s+/).length < 2) {
      throw validationFailed({ fullName: "Please enter both first and last name." });
    }
    data.fullName = fullName;
  }

  if (changes.phone !== undefined) data.phone = sanitiseText(changes.phone, 20);

  const user = await prisma.user.update({ where: { id: userId }, data });
  return toPublicUser(user);
}

/* ------------------------------------------------------------------ */
/* OAuth                                                               */
/* ------------------------------------------------------------------ */

export interface OAuthProfile {
  provider: string;
  providerAccountId: string;
  email: string | null;
  fullName: string;
}

/**
 * Find or create the account behind a third-party identity.
 *
 * The linking rule matters. If the provider gives us an email that already has
 * an account, the identity is attached to it rather than a duplicate account
 * being created — otherwise a user who registered with a password and later
 * clicks "sign in with Google" silently acquires a second, empty account and
 * cannot find their bookings.
 *
 * That link is only safe because Google and GitHub both verify the address
 * they hand over. An unverified email from a provider must never be treated as
 * proof of ownership, or account takeover is one signup away.
 */
export async function findOrCreateOAuthUser(profile: OAuthProfile): Promise<User> {
  const existingLink = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
      },
    },
    include: { user: true },
  });

  if (existingLink) return existingLink.user;

  const email = profile.email ? normaliseEmail(profile.email) : null;

  if (email) {
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      await prisma.oAuthAccount.create({
        data: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
          userId: byEmail.id,
        },
      });
      if (!byEmail.emailVerified) {
        await prisma.user.update({
          where: { id: byEmail.id },
          data: { emailVerified: true },
        });
      }
      return byEmail;
    }
  }

  if (!email) {
    // GitHub will withhold the address if the user has made it private, and an
    // account with no email cannot receive an itinerary — which makes it
    // useless for the one thing this system does.
    throw badRequest(
      "Your provider did not share an email address. Make your address public with that provider, or register with an email and password instead.",
    );
  }

  return prisma.user.create({
    data: {
      fullName: sanitiseText(profile.fullName || email.split("@")[0] || "Traveller", 100),
      email,
      emailVerified: true,
      passwordHash: null,
      role: "customer",
      oauthAccounts: {
        create: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      },
    },
  });
}

export async function listLinkedProviders(userId: string): Promise<string[]> {
  const accounts = await prisma.oAuthAccount.findMany({
    where: { userId },
    select: { provider: true },
  });
  return accounts.map((account) => account.provider);
}

/**
 * Unlink a provider, refusing to leave an account with no way back in. An
 * OAuth-only user who unlinks their sole provider would be locked out
 * permanently, so that request is denied rather than honoured.
 */
export async function unlinkProvider(userId: string, provider: string): Promise<void> {
  const [user, accounts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.oAuthAccount.findMany({ where: { userId } }),
  ]);

  if (!user) throw unauthorised();

  const target = accounts.find((account) => account.provider === provider);
  if (!target) throw badRequest("That provider is not linked to your account.");

  if (!user.passwordHash && accounts.length === 1) {
    throw conflict(
      "This is the only way you can sign in. Set a password before unlinking it.",
    );
  }

  await prisma.oAuthAccount.delete({ where: { id: target.id } });
}

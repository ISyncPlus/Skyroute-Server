/**
 * Environment configuration.
 *
 * Parsed and validated once, at import time. A missing or placeholder value
 * stops the process here rather than surfacing as a confusing failure on the
 * first request that happens to need it.
 */

import "dotenv/config";
import { z } from "zod";

/** Values still carrying their .env.example placeholder are treated as absent. */
const notPlaceholder = (value: string) => !value.toUpperCase().includes("REPLACE_ME");

const placeholder = { message: "still set to its .env.example placeholder" };

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  API_URL: z.string().url(),
  WEB_ORIGIN: z.string().min(1),

  DATABASE_URL: z.string().min(1).refine(notPlaceholder, placeholder),

  SESSION_SECRET: z
    .string()
    .min(32, "must be at least 32 characters")
    .refine(notPlaceholder, placeholder),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  COOKIE_DOMAIN: z.string().optional(),

  // OAuth is optional. A provider whose credentials are absent is simply not
  // mounted, so the server runs perfectly well before you have registered the
  // applications with Google and GitHub.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  SEED_ADMIN_EMAIL: z.string().email().default("admin@skyroute.test"),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_CUSTOMER_EMAIL: z.string().email().default("customer@skyroute.test"),
  SEED_CUSTOMER_PASSWORD: z.string().optional(),

  SCHEDULE_HORIZON_DAYS: z.coerce.number().int().positive().max(365).default(21),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  // Written to stderr directly: the logger itself depends on this module, so
  // it does not exist yet.
  process.stderr.write(
    `\nSkyRoute cannot start — the environment is not configured.\n\n${problems}\n\n` +
      "Copy .env.example to .env and fill in the missing values.\n\n",
  );
  process.exit(1);
}

const raw = parsed.data;

/** A provider is configured only when BOTH halves of its credential are present. */
function oauthProvider(id: string | undefined, secret: string | undefined) {
  const usable = Boolean(id && secret && notPlaceholder(id) && notPlaceholder(secret));
  return usable ? { clientId: id as string, clientSecret: secret as string } : null;
}

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === "production",
  isTest: raw.NODE_ENV === "test",

  /** Every origin permitted to call this API with credentials. */
  webOrigins: raw.WEB_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  sessionTtlMs: raw.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,

  oauth: {
    google: oauthProvider(raw.GOOGLE_CLIENT_ID, raw.GOOGLE_CLIENT_SECRET),
    github: oauthProvider(raw.GITHUB_CLIENT_ID, raw.GITHUB_CLIENT_SECRET),
  },
} as const;

export type Env = typeof env;

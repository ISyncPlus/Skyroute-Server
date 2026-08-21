/**
 * Password hashing.
 *
 * The browser build hashed with SHA-256 iterated a thousand times, which was a
 * reasonable choice for a client that only had SubtleCrypto to work with, but
 * it is not what you deploy. SHA-256 is fast and parallelises beautifully on a
 * GPU — exactly the properties an attacker with a stolen table wants.
 *
 * scrypt is memory-hard: each guess must allocate real memory, which is the
 * one resource that does not get cheaper by adding cores. It also ships inside
 * Node, so there is no native module to compile on the marker's machine and no
 * supply-chain surface added for the single most security-critical function in
 * the system.
 *
 * Stored format: scrypt$N$r$p$<salt-b64>$<hash-b64>
 * The parameters travel with the hash, so they can be raised later without
 * invalidating every password already in the database.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** ~64 MB per hash. Comfortable on a server, punishing at scale for a cracker. */
const PARAMS = { N: 2 ** 16, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** scrypt refuses to run if it would exceed maxmem, so give it headroom. */
const MAX_MEM = 256 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAX_MEM,
  });

  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verify a candidate password against a stored hash.
 *
 * Returns false rather than throwing on a malformed record: a corrupted row
 * should deny access, not crash the login endpoint for everybody.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];

  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P)) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  try {
    const derived = await scrypt(
      password.normalize("NFKC"),
      Buffer.from(saltB64, "base64"),
      expected.length,
      { N, r: R, p: P, maxmem: MAX_MEM },
    );

    // Constant-time: a comparison that returns early on the first differing
    // byte leaks, through timing, how much of the hash the guess got right.
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Whether a stored hash was produced with weaker parameters than the current
 * policy, so the caller can transparently re-hash on next successful login.
 */
export function needsRehash(stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < PARAMS.N;
}

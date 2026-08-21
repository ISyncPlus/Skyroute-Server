/**
 * Identifier generation.
 * ----------------------
 * PNRs (Passenger Name Records) are the six-character alphanumeric codes
 * airlines use to identify a reservation. Real systems avoid characters that
 * are easy to confuse when read aloud at a check-in desk, so we exclude
 * I, O, 0 and 1 from the alphabet.
 */

/** Unambiguous alphabet: no I, O, 0 or 1. */
export const PNR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const PNR_LENGTH = 6;

/**
 * Cryptographically strong random integers.
 *
 * Node has had webcrypto on globalThis since 18, so on the server the fallback
 * is unreachable — it is kept only so this module remains byte-identical in
 * behaviour to the browser build it was ported from.
 */
function randomInt(maxExclusive: number): number {
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    // Destructured with a default because the compiler cannot see that
    // getRandomValues always fills the array it was handed.
    const [value = 0] = buffer;
    return value % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

/** Generate a single six-character PNR. Uniqueness is enforced by the caller. */
export function generatePnr(): string {
  let pnr = "";
  for (let i = 0; i < PNR_LENGTH; i += 1) {
    pnr += PNR_ALPHABET[randomInt(PNR_ALPHABET.length)];
  }
  return pnr;
}

/**
 * Encode a number in the PNR alphabet, left-padded to `length`.
 *
 * The alphabet is 32 characters, so this is base-32 over a set chosen to be
 * unambiguous when read aloud. Using toString(36) here instead — as the first
 * version did — would emit 0, 1, I and O, and produce a reference that
 * isValidPnr subsequently rejects: a booking that exists and cannot be looked
 * up. Rare, but silent and unrecoverable, which is the worst combination.
 */
function encodeInAlphabet(value: number, length: number): string {
  const base = PNR_ALPHABET.length;
  let remaining = Math.abs(Math.floor(value));
  let encoded = "";

  for (let position = 0; position < length; position += 1) {
    encoded = PNR_ALPHABET[remaining % base] + encoded;
    remaining = Math.floor(remaining / base);
  }

  return encoded;
}

/**
 * Generate a PNR that does not collide with any code already in use.
 *
 * Falls back to a timestamp-derived code after `maxAttempts` collisions so the
 * function can never loop forever. With 32^6 ≈ 1.07 billion codes the fallback
 * is effectively unreachable, but "effectively unreachable" is not "cannot
 * happen", and the caller is inside a transaction that must terminate.
 */
export function generateUniquePnr(existing: Set<string> | string[], maxAttempts = 50): string {
  const taken = existing instanceof Set ? existing : new Set(existing);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generatePnr();
    if (!taken.has(candidate)) return candidate;
  }

  return `${generatePnr().slice(0, 2)}${encodeInAlphabet(Date.now(), 4)}`;
}

/** Validate the format of a PNR (used by the "find my booking" lookup). */
export function isValidPnr(value: string): boolean {
  if (typeof value !== "string") return false;
  const upper = value.trim().toUpperCase();
  if (upper.length !== PNR_LENGTH) return false;
  return upper.split("").every((char) => PNR_ALPHABET.includes(char));
}

/** Generic prefixed identifier for users, passengers and payments. */
export function generateId(prefix: string): string {
  const random = randomInt(0xffffff).toString(36).padStart(4, "0");
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

/** Simulated payment gateway transaction reference. */
export function generateTransactionReference(): string {
  return `TXN-${Date.now().toString(36).toUpperCase()}-${randomInt(0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0")}`;
}

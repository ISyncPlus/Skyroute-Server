/**
 * Password hashing and session tokens.
 *
 * These two modules are the ones where a subtle mistake does not fail a test
 * suite — it just quietly weakens the system — so they are tested for the
 * properties that matter rather than merely for round-tripping.
 */

import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "../src/lib/password.js";
import {
  digestsMatch,
  generateSessionToken,
  hashSessionToken,
  readSessionToken,
} from "../src/lib/session.js";

describe("password hashing", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword("Passw0rd!");
    await expect(verifyPassword("Passw0rd!", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("Passw0rd!");
    await expect(verifyPassword("Passw0rd", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("never stores the password in the hash", async () => {
    const hash = await hashPassword("SuperSecret123");
    expect(hash).not.toContain("SuperSecret123");
  });

  it("produces a different hash every time, so identical passwords do not match", async () => {
    const [a, b] = await Promise.all([hashPassword("Passw0rd!"), hashPassword("Passw0rd!")]);
    expect(a).not.toBe(b);

    // Both must still verify: the salt travels with the hash.
    await expect(verifyPassword("Passw0rd!", a)).resolves.toBe(true);
    await expect(verifyPassword("Passw0rd!", b)).resolves.toBe(true);
  });

  it("records the parameters alongside the digest so they can be raised later", async () => {
    const hash = await hashPassword("Passw0rd!");
    const [scheme, n, r, p] = hash.split("$");

    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(2 ** 16);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it("treats an account with no password as unverifiable rather than open", async () => {
    // An OAuth-only account must never be signed into with an empty password.
    await expect(verifyPassword("", null)).resolves.toBe(false);
    await expect(verifyPassword("anything", null)).resolves.toBe(false);
  });

  it("denies access on a corrupted record instead of throwing", async () => {
    await expect(verifyPassword("Passw0rd!", "not-a-real-hash")).resolves.toBe(false);
    await expect(verifyPassword("Passw0rd!", "scrypt$abc$8$1$xx$yy")).resolves.toBe(false);
    await expect(verifyPassword("Passw0rd!", "scrypt$65536$8$1$$")).resolves.toBe(false);
  });

  it("normalises unicode so the same typed password always verifies", async () => {
    // "é" composed vs decomposed: visually identical, different bytes.
    const composed = "caféPass1";
    const decomposed = "caféPass1";

    const hash = await hashPassword(composed);
    await expect(verifyPassword(decomposed, hash)).resolves.toBe(true);
  });

  it("flags a legacy or weaker hash for upgrade", async () => {
    expect(needsRehash("sha256$1000$salt$hash")).toBe(true);
    expect(needsRehash("scrypt$1024$8$1$salt$hash")).toBe(true);
    expect(needsRehash(await hashPassword("Passw0rd!"))).toBe(false);
    expect(needsRehash(null)).toBe(false);
  });
});

describe("session tokens", () => {
  it("issues tokens that do not repeat", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateSessionToken()));
    expect(tokens.size).toBe(500);
  });

  it("issues tokens with at least 256 bits of entropy", () => {
    // base64url of 32 bytes is 43 characters, unpadded.
    expect(generateSessionToken()).toHaveLength(43);
  });

  it("issues tokens that are URL and cookie safe", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("hashes deterministically, so a token can be looked up", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("hashes irreversibly, so a stolen database cannot be replayed", () => {
    const token = generateSessionToken();
    const digest = hashSessionToken(token);

    expect(digest).not.toContain(token);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("compares digests without accepting a mismatch", () => {
    const a = hashSessionToken("one");
    const b = hashSessionToken("two");

    expect(digestsMatch(a, a)).toBe(true);
    expect(digestsMatch(a, b)).toBe(false);
    expect(digestsMatch(a, "")).toBe(false);
    expect(digestsMatch("", "")).toBe(false);
  });
});

describe("reading a token from a request", () => {
  it("prefers the session cookie", () => {
    const token = readSessionToken({
      cookies: { skyroute_session: "cookie-token" },
      headers: { authorization: "Bearer header-token" },
    });
    expect(token).toBe("cookie-token");
  });

  it("falls back to a bearer header for non-browser clients", () => {
    expect(readSessionToken({ cookies: {}, headers: { authorization: "Bearer abc123" } })).toBe(
      "abc123",
    );
  });

  it("ignores a header that is not a bearer token", () => {
    expect(readSessionToken({ cookies: {}, headers: { authorization: "Basic abc123" } })).toBeNull();
    expect(readSessionToken({ cookies: {}, headers: { authorization: "Bearer " } })).toBeNull();
  });

  it("returns null when there is no credential at all", () => {
    expect(readSessionToken({ cookies: {}, headers: {} })).toBeNull();
    expect(readSessionToken({ headers: {} })).toBeNull();
  });
});

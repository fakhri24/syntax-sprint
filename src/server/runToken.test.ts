import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  RUN_TOKEN_TTL_MS,
  createRunTokenPayload,
  signRunToken,
  verifyRunToken,
  type RunTokenPayload,
} from "./runToken";

const SECRET = "a".repeat(43);
const OTHER_SECRET = "b".repeat(43);
const NOW = 1_700_000_000_000;

const payload = (overrides: Partial<RunTokenPayload> = {}): RunTokenPayload => ({
  uid: "u1",
  snippetId: "rocket-launch",
  serverStartMs: NOW,
  nonce: "nonce-1",
  expiresAt: NOW + RUN_TOKEN_TTL_MS,
  ...overrides,
});

describe("createRunTokenPayload", () => {
  it("binds the run to a user, a snippet, and a start time", () => {
    const created = createRunTokenPayload("u1", "rocket-launch", NOW);
    expect(created).toMatchObject({ uid: "u1", snippetId: "rocket-launch", serverStartMs: NOW });
    expect(created.expiresAt).toBe(NOW + RUN_TOKEN_TTL_MS);
  });

  it("gives every token a distinct nonce", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createRunTokenPayload("u1", "s", NOW).nonce));
    expect(nonces.size).toBe(50);
  });

  it("expires comfortably after any honest run but soon enough to bound the collection", () => {
    expect(RUN_TOKEN_TTL_MS).toBeGreaterThan(5 * 60_000);
    expect(RUN_TOKEN_TTL_MS).toBeLessThanOrEqual(60 * 60_000);
  });
});

describe("signRunToken / verifyRunToken", () => {
  it("round-trips a payload", () => {
    const token = signRunToken(payload(), SECRET);
    const check = verifyRunToken(token, SECRET, NOW);

    expect(check.ok).toBe(true);
    if (check.ok) expect(check.payload).toEqual(payload());
  });

  it("rejects a token signed with a different secret", () => {
    const token = signRunToken(payload(), OTHER_SECRET);
    expect(verifyRunToken(token, SECRET, NOW)).toMatchObject({ ok: false, reason: "bad signature" });
  });

  it("rejects a tampered payload", () => {
    const token = signRunToken(payload(), SECRET);
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify(payload({ uid: "someone-else" }))).toString("base64url");

    // The whole point: editing the payload invalidates the signature.
    expect(verifyRunToken(`${forged}.${signature}`, SECRET, NOW)).toMatchObject({
      ok: false,
      reason: "bad signature",
    });
  });

  it("rejects an expired token", () => {
    const token = signRunToken(payload(), SECRET);
    expect(verifyRunToken(token, SECRET, NOW + RUN_TOKEN_TTL_MS + 1)).toMatchObject({
      ok: false,
      reason: "token expired",
    });
  });

  it("accepts a token right up to its expiry", () => {
    const token = signRunToken(payload(), SECRET);
    expect(verifyRunToken(token, SECRET, NOW + RUN_TOKEN_TTL_MS).ok).toBe(true);
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of ["", "nodot", "..", "a.b.c", "!!!.???"]) {
      const check = verifyRunToken(bad, SECRET, NOW);
      expect(check.ok).toBe(false);
    }
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // timingSafeEqual throws on length mismatch; the length check must come first.
    const token = signRunToken(payload(), SECRET);
    const [body] = token.split(".");
    expect(() => verifyRunToken(`${body}.short`, SECRET, NOW)).not.toThrow();
    expect(verifyRunToken(`${body}.short`, SECRET, NOW)).toMatchObject({ ok: false });
  });

  it("rejects a validly signed but structurally wrong payload", () => {
    const body = Buffer.from(JSON.stringify({ uid: "u1" })).toString("base64url");
    const signature = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");

    expect(verifyRunToken(`${body}.${signature}`, SECRET, NOW)).toMatchObject({
      ok: false,
      reason: "malformed payload",
    });
  });

  it("refuses to operate without a secret", () => {
    expect(() => signRunToken(payload(), "")).toThrow(/RUN_TOKEN_SECRET/);
    expect(() => verifyRunToken("a.b", "", NOW)).toThrow(/RUN_TOKEN_SECRET/);
  });

  it("produces a URL-safe token", () => {
    const token = signRunToken(payload(), SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });
});

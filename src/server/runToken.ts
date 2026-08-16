/**
 * Single-use run tokens (AGENTS.md §4.13).
 *
 * Two layers, because neither alone is enough:
 *  - An HMAC signature makes forgery infeasible and is checked with no database
 *    access at all, so junk is rejected cheaply.
 *  - A redemption record makes the token single-use. A signature cannot do this:
 *    a stateless token is replayable until it expires.
 *
 * The token also carries `serverStartMs`, which is the only wall-clock evidence
 * the server has about when a run began — client timings are self-reported.
 */
import crypto from "node:crypto";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { RUN_TOKENS } from "@/lib/collections";
import type { RunTokenRecord } from "@/types/schema";

export const RUN_TOKEN_TTL_MS = 30 * 60 * 1000;
export { RUN_TOKENS as RUN_TOKENS_COLLECTION } from "@/lib/collections";

export interface RunTokenPayload {
  uid: string;
  snippetId: string;
  serverStartMs: number;
  nonce: string;
  expiresAt: number;
}

export type TokenCheck =
  | { ok: true; payload: RunTokenPayload }
  | { ok: false; reason: string };

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

function hmac(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

export function signRunToken(payload: RunTokenPayload, secret: string): string {
  if (!secret) throw new Error("RUN_TOKEN_SECRET is not set");
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body, secret)}`;
}

/**
 * Stateless half of the check: signature and expiry. Deliberately does no I/O,
 * so a forged or stale token never reaches the database.
 */
export function verifyRunToken(token: string, secret: string, now: number): TokenCheck {
  if (!secret) throw new Error("RUN_TOKEN_SECRET is not set");
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed token" };
  }

  const [body, signature] = token.split(".");
  if (!body || !signature) return { ok: false, reason: "malformed token" };

  const expected = hmac(body, secret);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  // Constant-time compare; length is checked first because timingSafeEqual
  // throws on a mismatch, which would itself leak length.
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return { ok: false, reason: "bad signature" };
  }

  let payload: RunTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed payload" };
  }

  if (
    typeof payload?.uid !== "string" ||
    typeof payload?.snippetId !== "string" ||
    typeof payload?.serverStartMs !== "number" ||
    typeof payload?.nonce !== "string" ||
    typeof payload?.expiresAt !== "number"
  ) {
    return { ok: false, reason: "malformed payload" };
  }

  if (now > payload.expiresAt) return { ok: false, reason: "token expired" };

  return { ok: true, payload };
}

export function createRunTokenPayload(uid: string, snippetId: string, now: number): RunTokenPayload {
  return {
    uid,
    snippetId,
    serverStartMs: now,
    nonce: crypto.randomUUID(),
    expiresAt: now + RUN_TOKEN_TTL_MS,
  };
}

/** Records the token as issued. A Firestore TTL policy on `expiresAt` reclaims it. */
export async function recordIssuedToken(db: Firestore, payload: RunTokenPayload): Promise<void> {
  const record: RunTokenRecord = {
    nonce: payload.nonce,
    uid: payload.uid,
    snippetId: payload.snippetId,
    serverStartMs: payload.serverStartMs,
    expiresAt: payload.expiresAt,
    status: "issued",
  };
  await db.collection(RUN_TOKENS).doc(payload.nonce).set(record);
}

/**
 * Stateful half, split in two because Firestore requires every read in a
 * transaction to happen before any write. The submit handler must also read the
 * leaderboard aggregates, so redemption cannot read-then-write in one step.
 *
 * Phase one: read and validate. Throws rather than returning a result — a
 * submission that reaches this point and cannot redeem must not be written
 * under any circumstances.
 */
export async function assertRedeemable(
  tx: Transaction,
  db: Firestore,
  payload: RunTokenPayload,
): Promise<DocumentReference> {
  const ref = db.collection(RUN_TOKENS).doc(payload.nonce);
  const snapshot = await tx.get(ref);

  if (!snapshot.exists) throw new Error("run token was never issued");

  const record = snapshot.data() as RunTokenRecord;
  if (record.status === "redeemed") throw new Error("run token already redeemed");
  // A token signed for one player must not be spendable by another, even though
  // the signature is valid.
  if (record.uid !== payload.uid) throw new Error("run token belongs to another user");
  if (record.snippetId !== payload.snippetId) throw new Error("run token is for another snippet");

  return ref;
}

/** Phase two: the write, issued after every read in the transaction. */
export function markRedeemed(tx: Transaction, ref: DocumentReference): void {
  tx.update(ref, { status: "redeemed" });
}

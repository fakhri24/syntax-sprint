import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  RUN_TOKENS_COLLECTION,
  createRunTokenPayload,
  assertRedeemable,
  markRedeemed,
  recordIssuedToken,
} from "@/server/runToken";
import type { RunTokenRecord } from "@/types/schema";

/**
 * The stateful half of §4.13, exercised against the emulator. The signature
 * checks are pure and covered in `src/server/runToken.test.ts`; what needs a
 * real database is the single-use guarantee, which is a property of the
 * transaction rather than of the token.
 *
 * The Admin SDK talks to the emulator whenever FIRESTORE_EMULATOR_HOST is set,
 * with no credentials involved — so this can never reach the real project.
 */

let app: App;
let db: Firestore;

const NOW = 1_700_000_000_000;

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  app = initializeApp({ projectId: "syntax-sprint-rules-test" }, `runtoken-${Date.now()}`);
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const existing = await db.collection(RUN_TOKENS_COLLECTION).get();
  await Promise.all(existing.docs.map((doc) => doc.ref.delete()));
});

async function issue(uid = "u1", snippetId = "rocket-launch") {
  const payload = createRunTokenPayload(uid, snippetId, NOW);
  await recordIssuedToken(db, payload);
  return payload;
}

const read = async (nonce: string) =>
  (await db.collection(RUN_TOKENS_COLLECTION).doc(nonce).get()).data() as RunTokenRecord | undefined;

/** Read-validate then write, the two phases the submit handler uses. */
const redeem = (payload: Awaited<ReturnType<typeof issue>>) =>
  db.runTransaction(async (tx) => {
    const ref = await assertRedeemable(tx, db, payload);
    markRedeemed(tx, ref);
  });

describe("recordIssuedToken", () => {
  it("stores the token as issued, with a TTL field to reclaim it", async () => {
    const payload = await issue();
    const record = await read(payload.nonce);

    expect(record).toMatchObject({
      nonce: payload.nonce,
      uid: "u1",
      snippetId: "rocket-launch",
      status: "issued",
    });
    // A Firestore TTL policy is configured on this field (§4.13).
    expect(record?.expiresAt).toBeGreaterThan(NOW);
  });
});

describe("redeemRunToken", () => {
  it("flips an issued token to redeemed", async () => {
    const payload = await issue();
    await redeem(payload);
    expect((await read(payload.nonce))?.status).toBe("redeemed");
  });

  it("refuses a second redemption — this is the whole single-use guarantee", async () => {
    const payload = await issue();
    await redeem(payload);
    await expect(redeem(payload)).rejects.toThrow(/already redeemed/);
  });

  it("refuses a nonce that was never issued", async () => {
    const payload = createRunTokenPayload("u1", "rocket-launch", NOW);
    await expect(redeem(payload)).rejects.toThrow(/never issued/);
  });

  it("refuses a token spent by a different user", async () => {
    const payload = await issue("u1");
    // A valid signature proves the token is ours, not that it is this caller's.
    await expect(redeem({ ...payload, uid: "u2" })).rejects.toThrow(/another user/);
  });

  it("refuses a token spent on a different snippet", async () => {
    const payload = await issue("u1", "rocket-launch");
    await expect(redeem({ ...payload, snippetId: "digital-badge" })).rejects.toThrow(/another snippet/);
  });

  it("lets exactly one of two concurrent redemptions win", async () => {
    const payload = await issue();

    const results = await Promise.allSettled([redeem(payload), redeem(payload)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");

    // Without transactional redemption, a double submit would score twice.
    expect(fulfilled).toHaveLength(1);
    expect((await read(payload.nonce))?.status).toBe("redeemed");
  });

  it("leaves the run unwritten when redemption fails", async () => {
    const payload = await issue();
    await redeem(payload);

    const runs = db.collection("runs");
    await expect(
      db.runTransaction(async (tx) => {
        const ref = await assertRedeemable(tx, db, payload);
        markRedeemed(tx, ref);
        tx.set(runs.doc("should-not-exist"), { id: "should-not-exist" });
      }),
    ).rejects.toThrow(/already redeemed/);

    // The atomicity that stops a spent token from still producing a score.
    expect((await runs.doc("should-not-exist").get()).exists).toBe(false);
  });

  it("keeps separate tokens independent", async () => {
    const first = await issue("u1");
    const second = await issue("u1");

    await redeem(first);
    await expect(redeem(second)).resolves.toBeUndefined();
  });
});

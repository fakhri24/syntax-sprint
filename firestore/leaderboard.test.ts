import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { GLOBAL_ENTRIES, SNIPPET_ENTRIES } from "@/lib/collections";
import { applyUpdates, decideUpdates, readEntries, snippetEntryId } from "@/server/leaderboard";
import type { LeaderboardEntry, RunRecord } from "@/types/schema";

/**
 * The aggregate rule against a real database (AGENTS.md §4.7).
 *
 * The decision logic is pure and covered in `src/server/leaderboard.test.ts`.
 * What needs the emulator is the part that only a database can show: that a
 * prolific player occupies exactly one row, and that ranking reads come out in
 * the right order.
 */

let app: App;
let db: Firestore;

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  app = initializeApp({ projectId: "syntax-sprint-rules-test" }, `leaderboard-${Date.now()}`);
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  for (const name of [SNIPPET_ENTRIES, GLOBAL_ENTRIES]) {
    const existing = await db.collection(name).get();
    await Promise.all(existing.docs.map((doc) => doc.ref.delete()));
  }
});

const run = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  id: `run-${Math.random().toString(36).slice(2)}`,
  userId: "u1",
  snippetId: "rocket-launch",
  grossWpm: 62,
  netWpm: 60,
  accuracy: 0.97,
  elapsedMs: 30_000,
  totalErrors: 2,
  verified: true,
  flags: [],
  createdAt: Date.now(),
  ...overrides,
});

/** Exactly the transaction shape the submit handler uses. */
async function submit(record: RunRecord, displayName = "Player") {
  const identity = { uid: record.userId, displayName, photoURL: "" };
  await db.runTransaction(async (tx) => {
    const existing = await readEntries(tx, db, record.snippetId, record.userId);
    const update = decideUpdates(record, identity, existing);
    applyUpdates(tx, db, record.userId, record.snippetId, update);
  });
}

const snippetBoard = async (snippetId: string) => {
  const snapshot = await db
    .collection(SNIPPET_ENTRIES)
    .where("snippetId", "==", snippetId)
    .orderBy("netWpm", "desc")
    .limit(100)
    .get();
  return snapshot.docs.map((d) => d.data() as LeaderboardEntry);
};

const globalBoard = async () => {
  const snapshot = await db.collection(GLOBAL_ENTRIES).orderBy("netWpm", "desc").limit(100).get();
  return snapshot.docs.map((d) => d.data() as LeaderboardEntry);
};

describe("aggregate maintenance", () => {
  it("creates both entries on a first run", async () => {
    await submit(run());

    expect(await snippetBoard("rocket-launch")).toHaveLength(1);
    expect(await globalBoard()).toHaveLength(1);
  });

  it("keeps one row per user however many runs they submit", async () => {
    // The whole reason aggregates exist: Firestore has no DISTINCT, so querying
    // `runs` directly would let this player fill the entire Top 100.
    for (const netWpm of [40, 55, 61, 48, 70, 52]) {
      await submit(run({ netWpm }));
    }

    const board = await snippetBoard("rocket-launch");
    expect(board).toHaveLength(1);
    expect(board[0].netWpm).toBe(70);
  });

  it("does not regress a personal best on a slower run", async () => {
    await submit(run({ netWpm: 80 }));
    await submit(run({ netWpm: 30 }));

    expect((await snippetBoard("rocket-launch"))[0].netWpm).toBe(80);
  });

  it("keeps a flagged run off the board entirely", async () => {
    await submit(run({ netWpm: 60 }));
    await submit(run({ netWpm: 249, verified: false, flags: ["low-variance"] }));

    expect((await snippetBoard("rocket-launch"))[0].netWpm).toBe(60);
  });

  it("gives each user their own row", async () => {
    await submit(run({ userId: "u1", netWpm: 50 }), "Ada");
    await submit(run({ userId: "u2", netWpm: 70 }), "Grace");
    await submit(run({ userId: "u3", netWpm: 60 }), "Alan");

    const board = await snippetBoard("rocket-launch");
    expect(board.map((e) => e.displayName)).toEqual(["Grace", "Alan", "Ada"]);
  });

  it("separates boards by snippet", async () => {
    await submit(run({ snippetId: "rocket-launch", netWpm: 50 }));
    await submit(run({ snippetId: "digital-badge", netWpm: 90 }));

    expect(await snippetBoard("rocket-launch")).toHaveLength(1);
    expect((await snippetBoard("digital-badge"))[0].netWpm).toBe(90);
    // One global row per user regardless of how many levels they played.
    expect(await globalBoard()).toHaveLength(1);
  });

  it("tracks the global best across levels independently of each snippet best", async () => {
    await submit(run({ snippetId: "rocket-launch", netWpm: 90 }));
    await submit(run({ snippetId: "digital-badge", netWpm: 40 }));

    // A personal best on the second level that is not a global best.
    expect((await snippetBoard("digital-badge"))[0].netWpm).toBe(40);
    expect((await globalBoard())[0].netWpm).toBe(90);
    expect((await globalBoard())[0].snippetId).toBe("rocket-launch");
  });

  it("uses a derived document id, so no query is needed to find a user's row", async () => {
    await submit(run({ userId: "u1" }));
    const doc = await db.collection(SNIPPET_ENTRIES).doc(snippetEntryId("rocket-launch", "u1")).get();
    expect(doc.exists).toBe(true);
  });

  it("refreshes a renamed player's denormalized name on their next best", async () => {
    await submit(run({ netWpm: 50 }), "Ada");
    await submit(run({ netWpm: 80 }), "Ada Lovelace");

    expect((await snippetBoard("rocket-launch"))[0].displayName).toBe("Ada Lovelace");
  });

  it("ranks a crowded board correctly", async () => {
    const speeds = [31, 92, 65, 78, 12, 55, 88, 43];
    await Promise.all(speeds.map((netWpm, i) => submit(run({ userId: `u${i}`, netWpm }))));

    const board = await snippetBoard("rocket-launch");
    expect(board).toHaveLength(speeds.length);
    expect(board.map((e) => e.netWpm)).toEqual([...speeds].sort((a, b) => b - a));
  });
});

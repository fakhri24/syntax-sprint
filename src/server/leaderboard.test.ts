import { describe, expect, it } from "vitest";
import { buildEntry, decideUpdates, shouldReplace, snippetEntryId } from "./leaderboard";
import type { LeaderboardEntry, RunRecord } from "@/types/schema";

const identity = { uid: "u1", displayName: "Ada", photoURL: "https://x/y.png" };

const run = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  id: "run1",
  userId: "u1",
  snippetId: "rocket-launch",
  grossWpm: 62,
  netWpm: 60,
  accuracy: 0.97,
  elapsedMs: 30_000,
  totalErrors: 2,
  verified: true,
  flags: [],
  createdAt: 1_700_000_000_000,
  ...overrides,
});

const entry = (netWpm: number): LeaderboardEntry => ({
  uid: "u1",
  snippetId: "rocket-launch",
  displayName: "Ada",
  photoURL: "",
  netWpm,
  grossWpm: netWpm + 2,
  accuracy: 1,
  runId: "old",
  achievedAt: 1,
});

describe("snippetEntryId", () => {
  it("derives the id, so finding a user's row needs no query", () => {
    expect(snippetEntryId("rocket-launch", "u1")).toBe("rocket-launch__u1");
  });
});

describe("buildEntry", () => {
  it("denormalizes the display fields so reads never fan out to users", () => {
    expect(buildEntry(run(), identity)).toEqual({
      uid: "u1",
      snippetId: "rocket-launch",
      displayName: "Ada",
      photoURL: "https://x/y.png",
      netWpm: 60,
      grossWpm: 62,
      accuracy: 0.97,
      runId: "run1",
      achievedAt: 1_700_000_000_000,
    });
  });
});

describe("shouldReplace", () => {
  it("accepts a first verified run", () => {
    expect(shouldReplace(null, run())).toBe(true);
  });

  it("accepts a faster verified run", () => {
    expect(shouldReplace(entry(50), run({ netWpm: 60 }))).toBe(true);
  });

  it("rejects a slower run", () => {
    expect(shouldReplace(entry(70), run({ netWpm: 60 }))).toBe(false);
  });

  it("rejects an equal run, so the board does not churn on ties", () => {
    expect(shouldReplace(entry(60), run({ netWpm: 60 }))).toBe(false);
  });

  it("rejects a flagged run however fast it is", () => {
    // Otherwise the verification in §4.6 would decide nothing.
    expect(shouldReplace(null, run({ verified: false, netWpm: 240 }))).toBe(false);
    expect(shouldReplace(entry(50), run({ verified: false, netWpm: 240 }))).toBe(false);
  });
});

describe("decideUpdates", () => {
  it("writes both aggregates for a first run", () => {
    const update = decideUpdates(run(), identity, { snippet: null, global: null });
    expect(update.snippet).not.toBeNull();
    expect(update.global).not.toBeNull();
  });

  it("treats the two boards independently", () => {
    // A personal best on this level that is not the player's best anywhere.
    const update = decideUpdates(run({ netWpm: 60 }), identity, {
      snippet: entry(55),
      global: entry(90),
    });

    expect(update.snippet).not.toBeNull();
    expect(update.global).toBeNull();
  });

  it("writes nothing when the run beats neither", () => {
    const update = decideUpdates(run({ netWpm: 40 }), identity, {
      snippet: entry(55),
      global: entry(90),
    });
    expect(update).toEqual({ snippet: null, global: null });
  });

  it("writes nothing for a flagged run, even a record-breaking one", () => {
    const update = decideUpdates(run({ verified: false, netWpm: 249 }), identity, {
      snippet: entry(55),
      global: entry(90),
    });
    expect(update).toEqual({ snippet: null, global: null });
  });

  it("carries the new run's identity, refreshing a renamed player", () => {
    const update = decideUpdates(run({ netWpm: 99 }), { ...identity, displayName: "Ada L" }, {
      snippet: entry(55),
      global: entry(55),
    });
    expect(update.snippet?.displayName).toBe("Ada L");
  });
});

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import fs from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "firebase/firestore";

/**
 * Rules tests for AGENTS.md §4.10. These run against the Firestore emulator, not
 * the real project — `npm run test:rules` starts one around them.
 *
 * Their job is to keep the trust boundary from regressing silently. Every one of
 * these collections is server-written; if a future change makes any of them
 * client-writable, the leaderboard becomes a POST request and nothing else in
 * the codebase would notice.
 */

let testEnv: RulesTestEnvironment;

const ALICE = "alice";
const BOB = "bob";

const profile = (uid: string, overrides: Record<string, unknown> = {}) => ({
  uid,
  displayName: "Alice",
  email: "alice@example.com",
  photoURL: "https://example.com/a.png",
  createdAt: 1_700_000_000_000,
  ...overrides,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "syntax-sprint-rules-test",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed through the privileged context, exactly as the Admin SDK would.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "snippets/rocket-launch"), { id: "rocket-launch", title: "Rocket Launch" });
    await setDoc(doc(db, "runs/run1"), { id: "run1", userId: ALICE, netWpm: 60, verified: true });
    await setDoc(doc(db, "leaderboardEntries/rocket-launch__alice"), { uid: ALICE, netWpm: 60 });
    await setDoc(doc(db, "globalEntries/alice"), { uid: ALICE, netWpm: 60 });
    await setDoc(doc(db, "runTokens/nonce-1"), { uid: ALICE, status: "issued" });
    await setDoc(doc(db, "users/alice"), profile(ALICE));
  });
});

const signedIn = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const anonymous = () => testEnv.unauthenticatedContext().firestore();

describe("snippets", () => {
  it("are readable by anyone, signed in or not", async () => {
    await assertSucceeds(getDoc(doc(anonymous(), "snippets/rocket-launch")));
    await assertSucceeds(getDocs(collection(signedIn(ALICE), "snippets")));
  });

  it("cannot be created, edited, or deleted by a client", async () => {
    const db = signedIn(ALICE);
    await assertFails(setDoc(doc(db, "snippets/forged"), { id: "forged", title: "Mine" }));
    await assertFails(setDoc(doc(db, "snippets/rocket-launch"), { title: "Edited" }));
    await assertFails(deleteDoc(doc(db, "snippets/rocket-launch")));
  });
});

describe("runs", () => {
  it("are publicly readable", async () => {
    await assertSucceeds(getDoc(doc(anonymous(), "runs/run1")));
  });

  it("cannot be written by a client — this is the whole anti-cheat boundary", async () => {
    const db = signedIn(ALICE);
    await assertFails(
      setDoc(doc(db, "runs/forged"), { id: "forged", userId: ALICE, netWpm: 9_999, verified: true }),
    );
  });

  it("cannot be written even for the client's own uid", async () => {
    // Ownership is not the point: the server is the only writer (§4.6).
    await assertFails(setDoc(doc(signedIn(ALICE), "runs/mine"), { userId: ALICE, netWpm: 60 }));
  });

  it("cannot be edited to flip verification or raise a score", async () => {
    const db = signedIn(ALICE);
    await assertFails(setDoc(doc(db, "runs/run1"), { netWpm: 500 }, { merge: true }));
    await assertFails(setDoc(doc(db, "runs/run1"), { verified: true }, { merge: true }));
  });

  it("cannot be deleted to hide a bad run", async () => {
    await assertFails(deleteDoc(doc(signedIn(ALICE), "runs/run1")));
  });
});

describe("leaderboard aggregates", () => {
  it("are publicly readable", async () => {
    await assertSucceeds(getDoc(doc(anonymous(), "leaderboardEntries/rocket-launch__alice")));
    await assertSucceeds(getDoc(doc(anonymous(), "globalEntries/alice")));
  });

  it("cannot be written by a client, even to their own entry", async () => {
    const db = signedIn(ALICE);
    // Writable aggregates would make run verification pointless: a cheat could
    // skip runs entirely and write the board directly.
    await assertFails(setDoc(doc(db, "leaderboardEntries/rocket-launch__alice"), { netWpm: 9_999 }));
    await assertFails(setDoc(doc(db, "globalEntries/alice"), { uid: ALICE, netWpm: 9_999 }));
  });

  it("cannot be written for another user", async () => {
    await assertFails(setDoc(doc(signedIn(BOB), "globalEntries/alice"), { uid: ALICE, netWpm: 0 }));
  });
});

describe("run tokens", () => {
  it("cannot be read — knowing an unredeemed nonce is most of a forgery", async () => {
    await assertFails(getDoc(doc(signedIn(ALICE), "runTokens/nonce-1")));
    await assertFails(getDoc(doc(anonymous(), "runTokens/nonce-1")));
  });

  it("cannot be created or redeemed by a client", async () => {
    const db = signedIn(ALICE);
    await assertFails(setDoc(doc(db, "runTokens/forged"), { uid: ALICE, status: "issued" }));
    await assertFails(setDoc(doc(db, "runTokens/nonce-1"), { status: "redeemed" }, { merge: true }));
  });
});

describe("user profiles", () => {
  it("are publicly readable", async () => {
    await assertSucceeds(getDoc(doc(anonymous(), "users/alice")));
  });

  it("let a signed-in user create their own profile", async () => {
    await assertSucceeds(setDoc(doc(signedIn(BOB), "users/bob"), profile(BOB)));
  });

  it("reject an anonymous write", async () => {
    await assertFails(setDoc(doc(anonymous(), "users/bob"), profile(BOB)));
  });

  it("reject writing someone else's profile", async () => {
    await assertFails(setDoc(doc(signedIn(BOB), "users/alice"), profile(ALICE)));
  });

  it("reject a uid field that disagrees with the document id", async () => {
    await assertFails(setDoc(doc(signedIn(BOB), "users/bob"), profile(BOB, { uid: ALICE })));
  });

  it("reject unknown fields, so a profile cannot smuggle app state", async () => {
    await assertFails(setDoc(doc(signedIn(BOB), "users/bob"), profile(BOB, { isAdmin: true })));
    await assertFails(setDoc(doc(signedIn(BOB), "users/bob"), profile(BOB, { netWpm: 999 })));
  });

  it("reject a profile missing required fields", async () => {
    await assertFails(setDoc(doc(signedIn(BOB), "users/bob"), { uid: BOB, displayName: "Bob" }));
  });

  it("reject wrong field types", async () => {
    await assertFails(setDoc(doc(signedIn(BOB), "users/bob"), profile(BOB, { displayName: 42 })));
    await assertFails(setDoc(doc(signedIn(BOB), "users/bob"), profile(BOB, { createdAt: "yesterday" })));
  });

  it("reject an oversized display name", async () => {
    await assertFails(setDoc(doc(signedIn(BOB), "users/bob"), profile(BOB, { displayName: "x".repeat(101) })));
  });

  it("allow a profile update but keep createdAt immutable", async () => {
    const db = signedIn(ALICE);
    await assertSucceeds(setDoc(doc(db, "users/alice"), profile(ALICE, { displayName: "Alice B" })));
    await assertFails(setDoc(doc(db, "users/alice"), profile(ALICE, { createdAt: 1 })));
  });

  it("reject deletion", async () => {
    await assertFails(deleteDoc(doc(signedIn(ALICE), "users/alice")));
  });
});

describe("collections with no rule of their own", () => {
  it("are denied by default", async () => {
    const db = signedIn(ALICE);
    await assertFails(getDoc(doc(db, "adminSettings/anything")));
    await assertFails(setDoc(doc(db, "adminSettings/anything"), { open: true }));
  });
});

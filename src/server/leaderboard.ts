/**
 * Best-per-user leaderboard aggregates (AGENTS.md §4.7).
 *
 * Raw `runs` cannot back a leaderboard: Firestore has no DISTINCT, so a single
 * fast player would fill the whole Top 100. These aggregates hold one row per
 * user, updated in the same transaction as the run so the board can never
 * disagree with the run history.
 *
 * The decision of *whether* to write is a pure function, so the rule — verified
 * runs only, and only when they beat the stored best — is testable without a
 * database.
 */
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { GLOBAL_ENTRIES, SNIPPET_ENTRIES } from "@/lib/collections";
import type { LeaderboardEntry, RunRecord } from "@/types/schema";

export { GLOBAL_ENTRIES, SNIPPET_ENTRIES } from "@/lib/collections";

/** One row per user per snippet. The id is derived, so no query is needed to find it. */
export function snippetEntryId(snippetId: string, uid: string): string {
  return `${snippetId}__${uid}`;
}

export interface EntryIdentity {
  uid: string;
  displayName: string;
  photoURL: string;
}

export function buildEntry(run: RunRecord, identity: EntryIdentity): LeaderboardEntry {
  return {
    uid: identity.uid,
    snippetId: run.snippetId,
    // Denormalized so leaderboard reads never fan out to `users` (§4.7).
    displayName: identity.displayName,
    photoURL: identity.photoURL,
    netWpm: run.netWpm,
    grossWpm: run.grossWpm,
    accuracy: run.accuracy,
    runId: run.id,
    achievedAt: run.createdAt,
  };
}

/**
 * A flagged run is still stored for history, but must not reach the board —
 * otherwise the verification in §4.6 would decide nothing.
 */
export function shouldReplace(existing: LeaderboardEntry | null, run: RunRecord): boolean {
  if (!run.verified) return false;
  if (!existing) return true;
  return run.netWpm > existing.netWpm;
}

export interface LeaderboardUpdate {
  snippet: LeaderboardEntry | null;
  global: LeaderboardEntry | null;
}

/**
 * Decides both aggregate writes at once. They are independent: a run can be a
 * personal best on this level without being the player's best anywhere.
 */
export function decideUpdates(
  run: RunRecord,
  identity: EntryIdentity,
  existing: { snippet: LeaderboardEntry | null; global: LeaderboardEntry | null },
): LeaderboardUpdate {
  const entry = buildEntry(run, identity);
  return {
    snippet: shouldReplace(existing.snippet, run) ? entry : null,
    global: shouldReplace(existing.global, run) ? entry : null,
  };
}

export function entryRefs(db: Firestore, snippetId: string, uid: string) {
  return {
    snippet: db.collection(SNIPPET_ENTRIES).doc(snippetEntryId(snippetId, uid)),
    global: db.collection(GLOBAL_ENTRIES).doc(uid),
  };
}

/** Transaction phase one: read both aggregates before anything is written. */
export async function readEntries(
  tx: Transaction,
  db: Firestore,
  snippetId: string,
  uid: string,
): Promise<{ snippet: LeaderboardEntry | null; global: LeaderboardEntry | null }> {
  const refs = entryRefs(db, snippetId, uid);
  const [snippet, global] = await Promise.all([tx.get(refs.snippet), tx.get(refs.global)]);
  return {
    snippet: snippet.exists ? (snippet.data() as LeaderboardEntry) : null,
    global: global.exists ? (global.data() as LeaderboardEntry) : null,
  };
}

/** Transaction phase two: apply whichever aggregates the rule selected. */
export function applyUpdates(
  tx: Transaction,
  db: Firestore,
  uid: string,
  snippetId: string,
  update: LeaderboardUpdate,
): void {
  const refs = entryRefs(db, snippetId, uid);
  if (update.snippet) tx.set(refs.snippet, update.snippet);
  if (update.global) tx.set(refs.global, update.global);
}

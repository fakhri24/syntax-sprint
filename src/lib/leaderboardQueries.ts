/**
 * Leaderboard reads (AGENTS.md §4.7).
 *
 * These query the aggregate collections, never `runs` — the aggregates hold one
 * row per user, which is the only way to get a Top 100 that is not dominated by
 * whoever played the most.
 */
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { GLOBAL_ENTRIES, SNIPPET_ENTRIES } from "./collections";
import type { LeaderboardEntry } from "@/types/schema";

export const LEADERBOARD_SIZE = 100;

const toEntries = (docs: { data: () => unknown }[]) => docs.map((d) => d.data() as LeaderboardEntry);

/**
 * Top runs for one level.
 * Needs the composite index (snippetId ASC, netWpm DESC) in firestore.indexes.json.
 */
export async function fetchSnippetLeaderboard(
  db: Firestore,
  snippetId: string,
  size = LEADERBOARD_SIZE,
): Promise<LeaderboardEntry[]> {
  const snapshot = await getDocs(
    query(
      collection(db, SNIPPET_ENTRIES),
      where("snippetId", "==", snippetId),
      orderBy("netWpm", "desc"),
      limit(size),
    ),
  );
  return toEntries(snapshot.docs);
}

/**
 * Each player's single best run across all levels. Difficulty is not weighted,
 * so this ranks raw speed and the UI shows which level a score came from.
 */
export async function fetchGlobalLeaderboard(
  db: Firestore,
  size = LEADERBOARD_SIZE,
): Promise<LeaderboardEntry[]> {
  const snapshot = await getDocs(
    query(collection(db, GLOBAL_ENTRIES), orderBy("netWpm", "desc"), limit(size)),
  );
  return toEntries(snapshot.docs);
}

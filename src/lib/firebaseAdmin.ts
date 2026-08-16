import "server-only";

/**
 * App-facing Admin SDK access — the only writer for `runs`, `snippets`, and the
 * leaderboard aggregates (AGENTS.md §4.10).
 *
 * The `server-only` import above turns any accidental client import into a
 * build error rather than a leaked private key. The initialization itself lives
 * in `@/server/adminApp` so the seed script, which runs outside React, can reuse
 * it without tripping that guard.
 */
export { getAdminAuth, getAdminDb } from "@/server/adminApp";

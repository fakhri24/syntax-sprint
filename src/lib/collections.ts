/**
 * Firestore collection names, in one neutral place.
 *
 * Client code must not import them from `@/server/*`: those modules pull in
 * firebase-admin, which has no business in a browser bundle. Keeping the names
 * here lets both sides share one spelling without sharing a dependency.
 */
export const SNIPPETS = "snippets";
export const RUNS = "runs";
export const SNIPPET_ENTRIES = "leaderboardEntries";
export const GLOBAL_ENTRIES = "globalEntries";
export const RUN_TOKENS = "runTokens";
export const USERS = "users";

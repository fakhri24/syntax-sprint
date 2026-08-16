// Firestore document shapes. Mirrors AGENTS.md §4.8 — keep the two in sync.

export type Difficulty = "easy" | "medium" | "hard";
export type Language = "css" | "svg" | "javascript";

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  createdAt: number;
}

/** Precomputed by Shiki at seed time; nothing highlights at runtime (§4.11). */
export interface HighlightToken {
  /** Inclusive offset into targetCode. */
  start: number;
  /** Exclusive offset into targetCode. */
  end: number;
  light: string;
  dark: string;
}

/** Seeded from content/snippets/. Client write-denied. */
export interface Snippet {
  id: string;
  title: string;
  difficulty: Difficulty;
  language: Language;
  targetCode: string;
  /** Characters the user actually types; excludes auto-skipped indentation (§4.2). */
  billableLength: number;
  /** Trusted: curated in-repo and code-reviewed, never user input. */
  initialStageHTML: string;
  /** JavaScript only. Character offsets at which the prefix is safe to execute (§4.4). */
  checkpoints: number[];
  tokens: HighlightToken[];
  /** Attribution only. Carries no write permission. */
  authorUid: string;
}

/**
 * A curated level as authored in content/snippets/ (AGENTS.md invariant #4).
 * Only what a human writes lives in a manifest; `billableLength`, `checkpoints`,
 * and `tokens` are derived by scripts/seedSnippets.ts so they can never drift.
 */
export type SnippetManifest = Pick<
  Snippet,
  "id" | "title" | "difficulty" | "language" | "targetCode" | "initialStageHTML" | "authorUid"
>;

/** Created only by /api/runs/submit. Client write-denied. */
export interface RunRecord {
  id: string;
  userId: string;
  snippetId: string;
  /** All metrics are server-recomputed from telemetry; client values are discarded. */
  grossWpm: number;
  netWpm: number;
  accuracy: number;
  elapsedMs: number;
  totalErrors: number;
  /** false = failed a heuristic; excluded from leaderboard aggregates. */
  verified: boolean;
  /** e.g. ['low-variance', 'sub-8ms-window'] */
  flags: string[];
  /** Server timestamp; client clocks are not trusted. */
  createdAt: number;
}

/** Best-per-user aggregate (§4.7). Server-maintained, client write-denied. */
export interface LeaderboardEntry {
  uid: string;
  snippetId: string;
  /** Denormalized so leaderboard reads never fan out to `users`. */
  displayName: string;
  photoURL: string;
  netWpm: number;
  grossWpm: number;
  accuracy: number;
  runId: string;
  achievedAt: number;
}

/** Single-use run token redemption record (§4.13). Fully client-denied. */
export interface RunTokenRecord {
  nonce: string;
  uid: string;
  snippetId: string;
  serverStartMs: number;
  /** Firestore TTL policy is configured on this field. */
  expiresAt: number;
  status: "issued" | "redeemed";
}

/** Telemetry payload posted to /api/runs/submit (§4.6). Never contains scores. */
export interface RunSubmission {
  runToken: string;
  snippetId: string;
  /** Milliseconds between consecutive accepted keystrokes. */
  intervals: number[];
  /** cursorIndex at each transition into the locked state. */
  errorOffsets: number[];
  clientElapsedMs: number;
}

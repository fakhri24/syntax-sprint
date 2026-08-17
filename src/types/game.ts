// Runtime game state. See AGENTS.md §4.1–§4.5.

/** Per-character render state in the editor viewport (§4.11). */
export type CharState =
  | "pending"
  /** The one character the caret is sitting on: the next key to press. */
  | "current"
  | "typed"
  | "error"
  /** Auto-skipped leading whitespace: visible, dimmed, never scored (§4.2). */
  | "skipped";

export type GamePhase = "IDLE" | "RUNNING" | "FINISHED";

/** Normalized input event produced by engine/input.ts (§4.1). */
export type GameInput =
  | { kind: "char"; char: string }
  | { kind: "enter" }
  | { kind: "backspace" };

export interface KeystrokeState {
  /** Offset into targetCode of the next character to type. */
  cursorIndex: number;
  /** Count of scored characters typed so far; excludes auto-skipped whitespace. */
  correctKeystrokes: number;
  hasError: boolean;
  /** At most one outstanding error character can exist (§4.3). */
  errorChar: string | null;
  /** Transitions into the locked state. Feeds Net WPM (§4.5). */
  totalErrors: number;
  /** Every rejected input including repeats while locked. Anti-cheat only. */
  blockedKeystrokes: number;
}

export interface Metrics {
  grossWpm: number;
  /** Error-penalized, deliberately not the textbook definition (§4.5). */
  netWpm: number;
  accuracy: number;
  elapsedMs: number;
}

/** Raw run telemetry accumulated client-side (§4.6). */
export interface TelemetryBuffer {
  intervals: number[];
  errorOffsets: number[];
}

/**
 * Keystroke telemetry recorder (AGENTS.md §4.6).
 *
 * The client never submits a score. It submits the raw shape of the run —
 * inter-keystroke timings and where the typos happened — and the server derives
 * every metric from that. This module is the client half; `validateTelemetry`
 * is shared with the server so both sides agree on what well-formed means.
 *
 * Pure and immutable, like the rest of the engine, so it composes with the
 * `keystroke.ts` reducer and is trivially testable.
 */
import type { RunStep } from "./keystroke";
import type { TelemetryBuffer } from "@/types/game";
import type { RunSubmission } from "@/types/schema";

/** Snippets are capped so a submission payload stays small (§4.6). */
export const MAX_BILLABLE_LENGTH = 1_000;

export interface TelemetryState extends TelemetryBuffer {
  /** Timestamp of the last accepted keystroke; null before the run starts. */
  lastAt: number | null;
}

export function createTelemetry(): TelemetryState {
  return { intervals: [], errorOffsets: [], lastAt: null };
}

/**
 * Records an accepted keystroke. The clock starts on the first keystroke, so
 * that one has nothing to measure against and contributes `0` — which is what
 * keeps `intervals.length === billableLength` and `sum(intervals) === elapsedMs`
 * true at the same time.
 */
export function recordAccepted(state: TelemetryState, now: number): TelemetryState {
  const interval = state.lastAt === null ? 0 : now - state.lastAt;
  return {
    ...state,
    intervals: [...state.intervals, interval],
    lastAt: now,
  };
}

/** Records a transition into the locked state at `cursorIndex` (an offset into targetCode). */
export function recordError(state: TelemetryState, cursorIndex: number): TelemetryState {
  return { ...state, errorOffsets: [...state.errorOffsets, cursorIndex] };
}

/**
 * Single wiring point: feeds one reducer step into the buffer. Blocked keypresses
 * and no-ops leave no trace — one typo is one entry, however long the player
 * mashed (§4.3).
 */
export function recordStep(state: TelemetryState, step: RunStep, now: number): TelemetryState {
  switch (step.effect) {
    case "accepted":
    case "completed":
      return recordAccepted(state, now);
    case "error":
      return recordError(state, step.state.cursorIndex);
    default:
      return state;
  }
}

export function elapsedFromTelemetry(state: TelemetryBuffer): number {
  return state.intervals.reduce((sum, interval) => sum + interval, 0);
}

export interface TelemetryExpectation {
  billableLength: number;
  /** Length of targetCode, which includes the auto-skipped indentation. */
  codeLength: number;
}

/**
 * Structural validation shared by the client (pre-submit sanity) and the server
 * (§4.6). Returns human-readable problems; empty means well-formed.
 *
 * This proves nothing about honesty — a bot can produce a perfectly well-formed
 * payload. The timing heuristics in §4.6 do that job; this only rejects payloads
 * that could not have come from a real run of this snippet.
 */
export function validateTelemetry(
  buffer: TelemetryBuffer,
  { billableLength, codeLength }: TelemetryExpectation,
): string[] {
  const problems: string[] = [];
  const { intervals, errorOffsets } = buffer;

  if (billableLength > MAX_BILLABLE_LENGTH) {
    problems.push(`snippet exceeds the ${MAX_BILLABLE_LENGTH}-character cap`);
  }

  if (intervals.length !== billableLength) {
    problems.push(`expected ${billableLength} intervals, got ${intervals.length}`);
  }

  if (intervals.length > 0 && intervals[0] !== 0) {
    problems.push("intervals[0] must be 0 — the clock starts on the first keystroke");
  }

  intervals.forEach((interval, index) => {
    if (!Number.isFinite(interval) || interval < 0) {
      problems.push(`intervals[${index}] is not a non-negative finite number`);
    }
  });

  errorOffsets.forEach((offset, index) => {
    if (!Number.isInteger(offset) || offset < 0 || offset >= codeLength) {
      problems.push(`errorOffsets[${index}] is outside the snippet`);
    }
    // The cursor never moves backwards (§4.3), so error positions cannot either.
    if (index > 0 && offset < errorOffsets[index - 1]) {
      problems.push(`errorOffsets[${index}] moves backwards; the cursor is monotonic`);
    }
  });

  return problems;
}

export interface SubmissionDraft {
  runToken: string;
  snippetId: string;
}

/** Builds the §4.6 payload. Deliberately carries no metrics — the server computes those. */
export function buildSubmission(
  state: TelemetryBuffer,
  { runToken, snippetId }: SubmissionDraft,
): RunSubmission {
  return {
    runToken,
    snippetId,
    intervals: state.intervals,
    errorOffsets: state.errorOffsets,
    clientElapsedMs: elapsedFromTelemetry(state),
  };
}

/**
 * Server-authoritative run verification (AGENTS.md §4.6).
 *
 * The client sends the shape of a run — inter-keystroke timings and where the
 * typos landed — and nothing else. Every number that ends up on the leaderboard
 * is recomputed here from that telemetry, using the very same `metrics.ts` the
 * client displays from, so the two can never disagree about the formula while
 * disagreeing about the result.
 *
 * Pure: no I/O, no clock of its own. That keeps it exhaustively testable, which
 * matters more here than anywhere else in the codebase.
 */
import { metricsFromTelemetry, roundMetrics } from "@/engine/metrics";
import { elapsedFromTelemetry, validateTelemetry } from "@/engine/telemetry";
import { analyzeTiming } from "./heuristics";
import type { RunTokenPayload } from "./runToken";
import type { Metrics } from "@/types/game";
import type { RunSubmission, Snippet } from "@/types/schema";

/** Beyond this, no human is typing (§4.6). */
export const MAX_PLAUSIBLE_WPM = 250;

/** `sum(intervals)` and `clientElapsedMs` are both client-derived; allow for rounding only. */
export const ELAPSED_TOLERANCE_MS = 50;

export type VerifyResult =
  | { ok: false; reason: string }
  | { ok: true; metrics: Metrics; flags: string[] };

export interface VerifyInput {
  submission: RunSubmission;
  snippet: Pick<Snippet, "id" | "billableLength" | "targetCode">;
  token: RunTokenPayload;
  /** Server time at submission. */
  now: number;
}

export function verifyRun({ submission, snippet, token, now }: VerifyInput): VerifyResult {
  if (submission.snippetId !== snippet.id) {
    return { ok: false, reason: "submission does not match the snippet" };
  }
  if (token.snippetId !== snippet.id) {
    return { ok: false, reason: "run token was issued for a different snippet" };
  }

  if (!Array.isArray(submission.intervals) || !Array.isArray(submission.errorOffsets)) {
    return { ok: false, reason: "telemetry is missing" };
  }

  // Shared with the client, so both sides agree on what well-formed means.
  const problems = validateTelemetry(submission, {
    billableLength: snippet.billableLength,
    codeLength: snippet.targetCode.length,
  });
  if (problems.length > 0) {
    return { ok: false, reason: problems[0] };
  }

  const elapsedMs = elapsedFromTelemetry(submission);

  if (typeof submission.clientElapsedMs !== "number" || !Number.isFinite(submission.clientElapsedMs)) {
    return { ok: false, reason: "clientElapsedMs is not a number" };
  }
  if (Math.abs(elapsedMs - submission.clientElapsedMs) > ELAPSED_TOLERANCE_MS) {
    return { ok: false, reason: "clientElapsedMs disagrees with the sum of intervals" };
  }

  // The one measurement the client cannot influence: a run cannot have taken
  // longer than the wall clock allows since the token was issued.
  const wallClockMs = now - token.serverStartMs;
  if (wallClockMs < 0) {
    return { ok: false, reason: "run token is from the future" };
  }
  if (elapsedMs > wallClockMs + ELAPSED_TOLERANCE_MS) {
    return { ok: false, reason: "run claims more time than has passed since it started" };
  }

  const metrics = metricsFromTelemetry(submission.intervals, submission.errorOffsets);

  if (metrics.grossWpm > MAX_PLAUSIBLE_WPM) {
    return { ok: false, reason: `${Math.round(metrics.grossWpm)} WPM exceeds the plausible maximum` };
  }

  // Heuristics flag rather than reject: they describe timing that does not look
  // like a hand, which is suspicion, not proof. A flagged run is stored and kept
  // off the leaderboard until a human reviews it (PLAN 4.1).
  const flags: string[] = analyzeTiming(submission.intervals);

  return { ok: true, metrics: roundMetrics(metrics), flags };
}

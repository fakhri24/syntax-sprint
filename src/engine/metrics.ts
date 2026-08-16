/**
 * Scoring formulas (AGENTS.md §4.5).
 *
 * Imported verbatim by both the client display layer and `server/verifyRun.ts`,
 * which is why this module must stay free of DOM and browser APIs: the server
 * recomputes every metric from telemetry, and the two must never drift.
 *
 * Note the deliberate departure from the textbook Net WPM. The Hard-Lock policy
 * makes it impossible for a wrong character to survive in the final text, so
 * uncorrected errors are always zero and the standard formula would collapse
 * into Gross WPM. Error *attempts* are penalized instead.
 */
import type { Metrics } from "@/types/game";

/** The typing-test convention: a "word" is five characters. */
export const CHARS_PER_WORD = 5;

/**
 * The only label the UI may use for netWpm. It is not the standard definition,
 * and players compare against other typing sites.
 */
export const NET_WPM_LABEL = "Net WPM (error-penalized)";

export interface MetricsInput {
  /** Scored characters typed; excludes auto-skipped indentation (§4.2). */
  correctKeystrokes: number;
  /** Transitions into the locked state, not every blocked keypress (§4.3). */
  totalErrors: number;
  elapsedMs: number;
}

function assertFinite(name: string, value: number, { allowZero = true } = {}) {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`metrics: ${name} must be a non-negative finite number, got ${value}`);
  }
}

function minutesOf(elapsedMs: number): number {
  return elapsedMs / 60_000;
}

export function grossWpm(correctKeystrokes: number, elapsedMs: number): number {
  assertFinite("correctKeystrokes", correctKeystrokes);
  assertFinite("elapsedMs", elapsedMs);
  // A run with no elapsed time has no rate. Guarding here keeps Infinity out of
  // the leaderboard and out of the live speedometer's first frame.
  if (elapsedMs === 0) return 0;
  return correctKeystrokes / CHARS_PER_WORD / minutesOf(elapsedMs);
}

export function netWpm(correctKeystrokes: number, totalErrors: number, elapsedMs: number): number {
  assertFinite("totalErrors", totalErrors);
  const gross = grossWpm(correctKeystrokes, elapsedMs);
  if (elapsedMs === 0) return 0;
  return Math.max(0, gross - totalErrors / minutesOf(elapsedMs));
}

/**
 * Share of keystroke attempts that landed. With the Hard-Lock policy the final
 * text is always perfect, so this measures the journey, not the result.
 */
export function accuracy(correctKeystrokes: number, totalErrors: number): number {
  assertFinite("correctKeystrokes", correctKeystrokes);
  assertFinite("totalErrors", totalErrors);
  const attempts = correctKeystrokes + totalErrors;
  // Nothing typed yet: report a clean slate rather than 0/0.
  if (attempts === 0) return 1;
  return correctKeystrokes / attempts;
}

export function computeMetrics({ correctKeystrokes, totalErrors, elapsedMs }: MetricsInput): Metrics {
  return {
    grossWpm: grossWpm(correctKeystrokes, elapsedMs),
    netWpm: netWpm(correctKeystrokes, totalErrors, elapsedMs),
    accuracy: accuracy(correctKeystrokes, totalErrors),
    elapsedMs,
  };
}

/**
 * Server-side reconstruction (§4.6). The client sends raw telemetry and none of
 * its own numbers; everything scored is derived here.
 *
 * `intervals[0]` is 0 by definition — the clock starts on the first keystroke,
 * so that keystroke has nothing to measure against.
 */
export function metricsFromTelemetry(intervals: number[], errorOffsets: number[]): Metrics {
  for (const [index, interval] of intervals.entries()) {
    assertFinite(`intervals[${index}]`, interval);
  }
  return computeMetrics({
    correctKeystrokes: intervals.length,
    totalErrors: errorOffsets.length,
    elapsedMs: intervals.reduce((sum, interval) => sum + interval, 0),
  });
}

/** Rounds for persistence and display. Kept out of the formulas so precision is lost once, at the edge. */
export function roundMetrics(metrics: Metrics): Metrics {
  const round2 = (value: number) => Math.round(value * 100) / 100;
  return {
    grossWpm: round2(metrics.grossWpm),
    netWpm: round2(metrics.netWpm),
    accuracy: round2(metrics.accuracy),
    elapsedMs: Math.round(metrics.elapsedMs),
  };
}

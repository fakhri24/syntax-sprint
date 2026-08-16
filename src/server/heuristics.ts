/**
 * Timing heuristics for run verification (AGENTS.md §4.6, PLAN 4.1).
 *
 * These do not prove cheating. They notice timing that does not look like a
 * hand — machine-uniform gaps, impossible bursts — and raise a flag. Flagged
 * runs are still stored; they are simply kept off the leaderboard until a human
 * looks. Rejection is reserved for things that are *impossible* (§4.6), not
 * merely suspicious.
 *
 * **`intervals[0]` is excluded from every check.** It is defined as 0 because
 * the clock starts on the first keystroke (§4.6), so including it would flag the
 * opening of every honest run as a sub-8ms burst.
 *
 * The thresholds below are initial estimates, not values fitted to real play.
 * Until a corpus of genuine runs exists they must stay advisory — which is why
 * nothing here rejects.
 */

/** No hand produces sustained gaps this short. */
export const MIN_HUMAN_INTERVAL_MS = 8;

/** How many consecutive sub-8ms gaps count as a burst rather than a fluke. */
export const BURST_LENGTH = 5;

/** Below this many samples, timing statistics say nothing worth acting on. */
export const MIN_SAMPLES_FOR_VARIANCE = 20;

/**
 * Coefficient of variation floor. CV rather than raw standard deviation,
 * because deviation scales with typing speed — a fast honest typist would fail
 * a fixed millisecond floor that a slow one passes.
 */
export const MIN_COEFFICIENT_OF_VARIATION = 0.15;

/** Share of intervals allowed to sit on a single value before it looks quantized. */
export const MAX_MODE_SHARE = 0.6;

export type HeuristicFlag = "low-variance" | "sub-8ms-window" | "quantized-intervals";

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance);
}

/** Share of values equal to the most common value. */
export function modeShare(values: number[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<number, number>();
  let best = 0;
  for (const value of values) {
    const next = (counts.get(value) ?? 0) + 1;
    counts.set(value, next);
    if (next > best) best = next;
  }
  return best / values.length;
}

/** Longest run of consecutive values below `threshold`. */
export function longestBurst(values: number[], threshold: number): number {
  let longest = 0;
  let current = 0;
  for (const value of values) {
    current = value < threshold ? current + 1 : 0;
    if (current > longest) longest = current;
  }
  return longest;
}

/**
 * The measurable intervals: everything after the defined-zero first entry.
 * Exported because every check depends on it and getting it wrong flags honest
 * runs in a way that is very hard to trace back.
 */
export function measurableIntervals(intervals: number[]): number[] {
  return intervals.slice(1);
}

export function analyzeTiming(intervals: number[]): HeuristicFlag[] {
  const samples = measurableIntervals(intervals);
  const flags: HeuristicFlag[] = [];

  if (samples.length === 0) return flags;

  if (longestBurst(samples, MIN_HUMAN_INTERVAL_MS) >= BURST_LENGTH) {
    flags.push("sub-8ms-window");
  }

  // Short runs are excluded from the distribution checks: a handful of
  // keystrokes can look uniform by chance, and flagging them would punish the
  // shortest levels hardest.
  if (samples.length >= MIN_SAMPLES_FOR_VARIANCE) {
    const average = mean(samples);
    if (average > 0 && standardDeviation(samples) / average < MIN_COEFFICIENT_OF_VARIATION) {
      flags.push("low-variance");
    }
    if (modeShare(samples) > MAX_MODE_SHARE) {
      flags.push("quantized-intervals");
    }
  }

  return flags;
}

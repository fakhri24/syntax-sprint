import { describe, expect, it } from "vitest";
import {
  BURST_LENGTH,
  MIN_SAMPLES_FOR_VARIANCE,
  analyzeTiming,
  longestBurst,
  measurableIntervals,
  mean,
  modeShare,
  standardDeviation,
} from "./heuristics";

/**
 * Deterministic pseudo-random so a "human-like" fixture cannot pass on one run
 * and flag on the next.
 */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

/** Irregular gaps with occasional pauses — what a hand actually produces. */
function humanRun(count: number, averageMs = 140, seed = 7): number[] {
  const random = seeded(seed);
  const intervals = [0];
  for (let i = 1; i < count; i += 1) {
    const jitter = 0.5 + random();
    const pause = random() < 0.08 ? 3 + random() * 4 : 1;
    intervals.push(Math.round(averageMs * jitter * pause));
  }
  return intervals;
}

/** A machine typing at a fixed rate. */
const botRun = (count: number, gapMs = 40) => [0, ...Array.from({ length: count - 1 }, () => gapMs)];

describe("statistics helpers", () => {
  it("computes mean and population standard deviation", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(standardDeviation([2, 4, 6])).toBeCloseTo(1.633, 3);
  });

  it("treats a single sample as having no deviation", () => {
    expect(standardDeviation([5])).toBe(0);
    expect(standardDeviation([])).toBe(0);
  });

  it("measures how concentrated values are on one number", () => {
    expect(modeShare([1, 1, 1, 2])).toBe(0.75);
    expect(modeShare([1, 2, 3, 4])).toBe(0.25);
    expect(modeShare([])).toBe(0);
  });

  it("finds the longest consecutive burst below a threshold", () => {
    expect(longestBurst([1, 1, 50, 1, 1, 1], 8)).toBe(3);
    expect(longestBurst([50, 50], 8)).toBe(0);
  });
});

describe("measurableIntervals", () => {
  it("drops the defined-zero first entry", () => {
    // intervals[0] is 0 by definition (§4.6); counting it would flag the start
    // of every honest run as an impossible burst.
    expect(measurableIntervals([0, 120, 140])).toEqual([120, 140]);
  });
});

describe("analyzeTiming", () => {
  it("does not flag a human-like run", () => {
    expect(analyzeTiming(humanRun(120))).toEqual([]);
  });

  it("does not flag a fast human-like run", () => {
    // ~55ms between keystrokes is quick but real, and must not be punished.
    expect(analyzeTiming(humanRun(120, 55, 42))).toEqual([]);
  });

  it("never flags a run purely for its leading zero", () => {
    const run = humanRun(60);
    expect(run[0]).toBe(0);
    expect(analyzeTiming(run)).not.toContain("sub-8ms-window");
  });

  it("flags a constant-interval bot for low variance", () => {
    expect(analyzeTiming(botRun(80))).toContain("low-variance");
  });

  it("flags a bot for quantized intervals as well", () => {
    expect(analyzeTiming(botRun(80))).toContain("quantized-intervals");
  });

  it("flags a sustained sub-8ms burst", () => {
    const run = [0, ...Array.from({ length: BURST_LENGTH }, () => 2), 140, 150, 130];
    expect(analyzeTiming(run)).toContain("sub-8ms-window");
  });

  it("tolerates a burst shorter than the threshold", () => {
    const run = [0, ...Array.from({ length: BURST_LENGTH - 1 }, () => 2), ...humanRun(40).slice(1)];
    expect(analyzeTiming(run)).not.toContain("sub-8ms-window");
  });

  it("stays quiet on short runs, where timing statistics say nothing", () => {
    // Uniform by chance is common in a handful of keystrokes; flagging it would
    // punish the shortest levels hardest.
    const shortUniform = botRun(MIN_SAMPLES_FOR_VARIANCE - 1);
    expect(analyzeTiming(shortUniform)).not.toContain("low-variance");
    expect(analyzeTiming(shortUniform)).not.toContain("quantized-intervals");
  });

  it("still catches an impossible burst in a short run", () => {
    // Speed that no hand can produce is not a statistical question.
    const run = [0, 1, 1, 1, 1, 1, 200];
    expect(analyzeTiming(run)).toContain("sub-8ms-window");
  });

  it("does not flag a bot that jitters like a hand", () => {
    // Honest about the limit: a good imitation passes. These are heuristics,
    // not proof, which is exactly why they only flag.
    expect(analyzeTiming(humanRun(120, 60, 99))).toEqual([]);
  });

  it("returns nothing for an empty or single-keystroke run", () => {
    expect(analyzeTiming([])).toEqual([]);
    expect(analyzeTiming([0])).toEqual([]);
  });

  it("is stable across seeds for human-like input", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(analyzeTiming(humanRun(150, 120, seed)), `seed ${seed}`).toEqual([]);
    }
  });
});

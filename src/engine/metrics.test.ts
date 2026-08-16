import { describe, expect, it } from "vitest";
import {
  CHARS_PER_WORD,
  accuracy,
  computeMetrics,
  grossWpm,
  metricsFromTelemetry,
  netWpm,
  roundMetrics,
} from "./metrics";
import { applyInputs, createRunState, inputsForSnippet, runElapsedMs } from "./keystroke";
import { normalizeSnippet } from "./layout";

const MINUTE = 60_000;

describe("grossWpm", () => {
  it("treats five characters as one word", () => {
    expect(grossWpm(CHARS_PER_WORD * 60, MINUTE)).toBe(60);
  });

  it("scales with elapsed time", () => {
    expect(grossWpm(100, MINUTE)).toBe(20);
    expect(grossWpm(100, MINUTE / 2)).toBe(40);
  });

  it("returns zero rather than Infinity when no time has elapsed", () => {
    expect(grossWpm(10, 0)).toBe(0);
  });

  it("rejects negative input", () => {
    expect(() => grossWpm(-1, MINUTE)).toThrow(/non-negative/);
    expect(() => grossWpm(10, -1)).toThrow(/non-negative/);
    expect(() => grossWpm(10, Number.NaN)).toThrow(/non-negative/);
  });
});

describe("netWpm", () => {
  it("equals grossWpm on a perfect run — the collapse case (§4.5)", () => {
    expect(netWpm(500, 0, MINUTE)).toBe(grossWpm(500, MINUTE));
  });

  it("costs exactly one word-per-minute per error, per minute", () => {
    expect(netWpm(500, 3, MINUTE)).toBe(grossWpm(500, MINUTE) - 3);
  });

  it("scales the penalty with run length, like the gross rate", () => {
    // Three errors in half a minute hurt twice as much as three in a full minute.
    expect(grossWpm(250, MINUTE / 2) - netWpm(250, 3, MINUTE / 2)).toBe(6);
  });

  it("never goes negative", () => {
    expect(netWpm(5, 100, MINUTE)).toBe(0);
  });

  it("is zero when no time has elapsed", () => {
    expect(netWpm(10, 2, 0)).toBe(0);
  });
});

describe("accuracy", () => {
  it("is 1 for a run with no errors", () => {
    expect(accuracy(100, 0)).toBe(1);
  });

  it("counts error attempts, since the final text is always perfect", () => {
    expect(accuracy(90, 10)).toBe(0.9);
  });

  it("reports a clean slate before anything is typed", () => {
    expect(accuracy(0, 0)).toBe(1);
  });

  it("ignores how long the player mashed while locked", () => {
    // blockedKeystrokes never reaches this function (§4.3).
    expect(accuracy(99, 1)).toBe(0.99);
  });
});

describe("computeMetrics", () => {
  it("bundles the three formulas with elapsed time", () => {
    const metrics = computeMetrics({ correctKeystrokes: 300, totalErrors: 6, elapsedMs: MINUTE });
    expect(metrics).toEqual({
      grossWpm: 60,
      netWpm: 54,
      accuracy: 300 / 306,
      elapsedMs: MINUTE,
    });
  });
});

describe("metricsFromTelemetry", () => {
  it("derives every metric from raw telemetry alone", () => {
    // 300 keystrokes, first one free, 200ms apart => 59.8s.
    const intervals = [0, ...Array.from({ length: 299 }, () => 200)];
    const metrics = metricsFromTelemetry(intervals, [10, 42]);

    expect(metrics.elapsedMs).toBe(299 * 200);
    expect(metrics.grossWpm).toBeCloseTo(300 / 5 / (59_800 / MINUTE), 6);
    expect(metrics.accuracy).toBeCloseTo(300 / 302, 6);
  });

  it("agrees with computeMetrics for the same run", () => {
    const intervals = [0, 100, 100, 100];
    expect(metricsFromTelemetry(intervals, [2])).toEqual(
      computeMetrics({ correctKeystrokes: 4, totalErrors: 1, elapsedMs: 300 }),
    );
  });

  it("handles an empty run without dividing by zero", () => {
    expect(metricsFromTelemetry([], [])).toEqual({
      grossWpm: 0,
      netWpm: 0,
      accuracy: 1,
      elapsedMs: 0,
    });
  });

  it("rejects malformed intervals", () => {
    expect(() => metricsFromTelemetry([0, -5], [])).toThrow(/intervals\[1\]/);
  });
});

describe("roundMetrics", () => {
  it("rounds rates to two decimals and elapsed to whole milliseconds", () => {
    expect(roundMetrics({ grossWpm: 61.23456, netWpm: 59.98765, accuracy: 0.98765, elapsedMs: 1234.6 })).toEqual({
      grossWpm: 61.23,
      netWpm: 59.99,
      accuracy: 0.99,
      elapsedMs: 1235,
    });
  });
});

describe("integration with the keystroke engine", () => {
  const CSS = normalizeSnippet(`.a {
  color: red;
}`);

  it("scores a clean run at exactly gross === net", () => {
    const inputs = inputsForSnippet(CSS);
    const state = applyInputs(createRunState(CSS), inputs, CSS, 0, 100);
    const metrics = computeMetrics({
      correctKeystrokes: state.correctKeystrokes,
      totalErrors: state.totalErrors,
      elapsedMs: runElapsedMs(state, 0),
    });

    expect(state.totalErrors).toBe(0);
    expect(metrics.netWpm).toBe(metrics.grossWpm);
    expect(metrics.accuracy).toBe(1);
  });

  it("does not let indentation depth inflate the score", () => {
    const shallow = normalizeSnippet("a {\n  b: 1;\n}");
    const deep = normalizeSnippet("a {\n          b: 1;\n}");

    const score = (code: string) => {
      const state = applyInputs(createRunState(code), inputsForSnippet(code), code, 0, 100);
      return computeMetrics({
        correctKeystrokes: state.correctKeystrokes,
        totalErrors: state.totalErrors,
        elapsedMs: runElapsedMs(state, 0),
      }).grossWpm;
    };

    expect(score(deep)).toBe(score(shallow));
  });

  it("charges one error for a typo however long the player mashes", () => {
    const inputs = inputsForSnippet(CSS);
    const withMashing = [
      { kind: "char", char: "x" } as const,
      ...Array.from({ length: 15 }, () => ({ kind: "char", char: "y" }) as const),
      { kind: "backspace" } as const,
      ...inputs,
    ];
    const state = applyInputs(createRunState(CSS), withMashing, CSS, 0, 100);

    expect(state.totalErrors).toBe(1);
    expect(state.blockedKeystrokes).toBe(15);
    expect(accuracy(state.correctKeystrokes, state.totalErrors)).toBeCloseTo(
      state.correctKeystrokes / (state.correctKeystrokes + 1),
      6,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_BILLABLE_LENGTH,
  buildSubmission,
  createTelemetry,
  elapsedFromTelemetry,
  recordAccepted,
  recordStep,
  validateTelemetry,
  type TelemetryState,
} from "./telemetry";
import { applyInput, createRunState, inputsForSnippet, type RunState } from "./keystroke";
import { computeBillableLength, normalizeSnippet } from "./layout";
import { metricsFromTelemetry } from "./metrics";
import type { GameInput } from "@/types/game";

const CSS = normalizeSnippet(`.a {
  color: red;
}`);

const char = (c: string): GameInput => ({ kind: "char", char: c });
const BACKSPACE: GameInput = { kind: "backspace" };

/** Runs inputs through the reducer and the recorder together, as the arena will. */
function record(code: string, inputs: GameInput[], stepMs = 100) {
  let run: RunState = createRunState(code);
  let telemetry: TelemetryState = createTelemetry();

  inputs.forEach((input, i) => {
    const now = i * stepMs;
    const step = applyInput(run, input, code, now);
    run = step.state;
    telemetry = recordStep(telemetry, step, now);
  });

  return { run, telemetry };
}

describe("recordAccepted", () => {
  it("gives the first keystroke a zero interval", () => {
    const state = recordAccepted(createTelemetry(), 5_000);
    expect(state.intervals).toEqual([0]);
    expect(state.lastAt).toBe(5_000);
  });

  it("measures deltas between consecutive keystrokes", () => {
    let state = recordAccepted(createTelemetry(), 1_000);
    state = recordAccepted(state, 1_120);
    state = recordAccepted(state, 1_300);
    expect(state.intervals).toEqual([0, 120, 180]);
  });

  it("keeps sum(intervals) equal to the elapsed run time", () => {
    let state = recordAccepted(createTelemetry(), 1_000);
    for (const at of [1_100, 1_250, 1_400]) state = recordAccepted(state, at);
    expect(elapsedFromTelemetry(state)).toBe(1_400 - 1_000);
  });

  it("does not mutate the state it is given", () => {
    const original = createTelemetry();
    recordAccepted(original, 1);
    expect(original.intervals).toEqual([]);
    expect(original.lastAt).toBe(null);
  });
});

describe("recordStep", () => {
  it("records one interval per accepted keystroke and nothing else", () => {
    const { run, telemetry } = record(CSS, inputsForSnippet(CSS));
    expect(telemetry.intervals).toHaveLength(computeBillableLength(CSS));
    expect(telemetry.errorOffsets).toEqual([]);
    expect(run.clock.phase).toBe("FINISHED");
  });

  it("records one error offset per typo, not per blocked keypress", () => {
    const mashing = Array.from({ length: 12 }, () => char("z"));
    const { run, telemetry } = record(CSS, [char("x"), ...mashing, BACKSPACE, char(".")]);

    expect(telemetry.errorOffsets).toEqual([0]);
    expect(run.blockedKeystrokes).toBe(12);
    expect(telemetry.intervals).toEqual([0]); // only the successful "." counted
  });

  it("records the cursor position where the typo happened", () => {
    const { telemetry } = record(CSS, [char("."), char("a"), char("!")]);
    expect(telemetry.errorOffsets).toEqual([2]);
  });

  it("leaves no trace for a no-op backspace", () => {
    const { telemetry } = record(CSS, [BACKSPACE, BACKSPACE]);
    expect(telemetry).toEqual(createTelemetry());
  });

  it("excludes blocked time from the intervals", () => {
    // Typo, a long pause while locked, then backspace and continue: the interval
    // for the next accepted keystroke still spans the whole pause, because the
    // clock never stops — only the keystroke count is unaffected.
    const { telemetry } = record(CSS, [char("."), char("!"), BACKSPACE, char("a")], 1_000);
    expect(telemetry.intervals).toEqual([0, 3_000]);
  });
});

describe("validateTelemetry", () => {
  const expectation = { billableLength: 4, codeLength: 10 };

  const buffer = (intervals: number[], errorOffsets: number[] = []) => ({ intervals, errorOffsets });

  it("accepts a well-formed payload", () => {
    expect(validateTelemetry(buffer([0, 100, 90, 110], [3, 7]), expectation)).toEqual([]);
  });

  it("rejects a wrong interval count", () => {
    expect(validateTelemetry(buffer([0, 100]), expectation)).toContain("expected 4 intervals, got 2");
  });

  it("rejects a non-zero first interval", () => {
    expect(validateTelemetry(buffer([50, 100, 90, 110]), expectation)).toContain(
      "intervals[0] must be 0 — the clock starts on the first keystroke",
    );
  });

  it("rejects negative and non-finite intervals", () => {
    expect(validateTelemetry(buffer([0, -1, 90, 110]), expectation)).toContain(
      "intervals[1] is not a non-negative finite number",
    );
    expect(validateTelemetry(buffer([0, Number.NaN, 90, 110]), expectation)).toContain(
      "intervals[1] is not a non-negative finite number",
    );
  });

  it("rejects an error offset outside the snippet", () => {
    expect(validateTelemetry(buffer([0, 1, 1, 1], [10]), expectation)).toContain(
      "errorOffsets[0] is outside the snippet",
    );
  });

  it("allows an error offset beyond billableLength but inside targetCode", () => {
    // Indentation makes targetCode longer than billableLength; an offset in that
    // range is legitimate, and validating against the wrong length would reject
    // honest runs on every indented snippet.
    expect(validateTelemetry(buffer([0, 1, 1, 1], [8]), expectation)).toEqual([]);
  });

  it("rejects error offsets that move backwards", () => {
    expect(validateTelemetry(buffer([0, 1, 1, 1], [5, 2]), expectation)).toContain(
      "errorOffsets[1] moves backwards; the cursor is monotonic",
    );
  });

  it("rejects a snippet over the payload cap", () => {
    const long = MAX_BILLABLE_LENGTH + 1;
    const problems = validateTelemetry(buffer(new Array(long).fill(0)), {
      billableLength: long,
      codeLength: long,
    });
    expect(problems).toContain(`snippet exceeds the ${MAX_BILLABLE_LENGTH}-character cap`);
  });
});

describe("buildSubmission", () => {
  it("carries telemetry and no metrics at all", () => {
    const { telemetry } = record(CSS, inputsForSnippet(CSS));
    const submission = buildSubmission(telemetry, { runToken: "tok", snippetId: "s1" });

    expect(Object.keys(submission).sort()).toEqual([
      "clientElapsedMs",
      "errorOffsets",
      "intervals",
      "runToken",
      "snippetId",
    ]);
    expect(submission.clientElapsedMs).toBe(elapsedFromTelemetry(telemetry));
  });
});

describe("end-to-end: recorded telemetry reconstructs the run", () => {
  it("lets the server derive the same metrics the client saw", () => {
    const inputs = inputsForSnippet(CSS);
    // Insert a typo and its correction partway through.
    const withTypo = [...inputs.slice(0, 5), char("~"), BACKSPACE, ...inputs.slice(5)];
    const { run, telemetry } = record(CSS, withTypo, 100);

    const submission = buildSubmission(telemetry, { runToken: "tok", snippetId: "s1" });
    const problems = validateTelemetry(submission, {
      billableLength: computeBillableLength(CSS),
      codeLength: CSS.length,
    });
    expect(problems).toEqual([]);

    const serverMetrics = metricsFromTelemetry(submission.intervals, submission.errorOffsets);
    expect(serverMetrics.elapsedMs).toBe(submission.clientElapsedMs);
    // The server reaches the client's counts without being told them.
    expect(submission.intervals.length).toBe(run.correctKeystrokes);
    expect(submission.errorOffsets.length).toBe(run.totalErrors);
  });
});

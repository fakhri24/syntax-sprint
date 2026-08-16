import { describe, expect, it } from "vitest";
import { ELAPSED_TOLERANCE_MS, MAX_PLAUSIBLE_WPM, verifyRun } from "./verifyRun";
import { RUN_TOKEN_TTL_MS, type RunTokenPayload } from "./runToken";
import { applyInput, createRunState, inputsForSnippet } from "@/engine/keystroke";
import { createTelemetry, buildSubmission, recordStep } from "@/engine/telemetry";
import { computeBillableLength, normalizeSnippet } from "@/engine/layout";
import type { RunSubmission } from "@/types/schema";

const CODE = normalizeSnippet(`.a {
  color: red;
}`);

const SNIPPET = { id: "s1", billableLength: computeBillableLength(CODE), targetCode: CODE };

const TOKEN: RunTokenPayload = {
  uid: "u1",
  snippetId: "s1",
  serverStartMs: 1_000_000,
  nonce: "n1",
  expiresAt: 1_000_000 + RUN_TOKEN_TTL_MS,
};

/** Plays a real run through the engine so the telemetry is genuine, not invented. */
function runOn(code: string, stepMs: number, jitter = false): RunSubmission {
  let run = createRunState(code);
  let telemetry = createTelemetry();
  let clock = 0;
  // Deterministic wobble, so an "irregular" fixture cannot pass by luck.
  let seed = 12345;
  const next = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return seed / 4_294_967_296;
  };

  inputsForSnippet(code).forEach((input, i) => {
    clock += i === 0 ? 0 : Math.round(stepMs * (jitter ? 0.4 + next() * 1.6 : 1));
    const step = applyInput(run, input, code, clock);
    run = step.state;
    telemetry = recordStep(telemetry, step, clock);
  });

  return buildSubmission(telemetry, { runToken: "tok", snippetId: "s1" });
}

const realRun = (stepMs: number) => runOn(CODE, stepMs);

const at = (submission: RunSubmission) => TOKEN.serverStartMs + submission.clientElapsedMs + 500;

describe("verifyRun", () => {
  it("accepts an honest run and recomputes its metrics", () => {
    const submission = realRun(120);
    const result = verifyRun({ submission, snippet: SNIPPET, token: TOKEN, now: at(submission) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metrics.elapsedMs).toBe(submission.clientElapsedMs);
    expect(result.metrics.grossWpm).toBeGreaterThan(0);
    expect(result.flags).toEqual([]);
  });

  it("derives metrics from telemetry alone, ignoring anything else the client sends", () => {
    const submission = realRun(120);
    const inflated = { ...submission, grossWpm: 9_999, netWpm: 9_999 } as RunSubmission;

    const honest = verifyRun({ submission, snippet: SNIPPET, token: TOKEN, now: at(submission) });
    const tampered = verifyRun({ submission: inflated, snippet: SNIPPET, token: TOKEN, now: at(submission) });

    expect(honest).toEqual(tampered);
  });

  it("rejects a submission for a different snippet", () => {
    const submission = { ...realRun(120), snippetId: "other" };
    const result = verifyRun({ submission, snippet: SNIPPET, token: TOKEN, now: at(submission) });
    expect(result).toMatchObject({ ok: false, reason: /does not match the snippet/ });
  });

  it("rejects a token issued for a different snippet", () => {
    const submission = realRun(120);
    const result = verifyRun({
      submission,
      snippet: SNIPPET,
      token: { ...TOKEN, snippetId: "other" },
      now: at(submission),
    });
    expect(result).toMatchObject({ ok: false, reason: /issued for a different snippet/ });
  });

  it("rejects telemetry of the wrong length", () => {
    const submission = realRun(120);
    submission.intervals = submission.intervals.slice(0, -1);
    const result = verifyRun({ submission, snippet: SNIPPET, token: TOKEN, now: at(submission) });
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects missing telemetry arrays", () => {
    const submission = { ...realRun(120), intervals: undefined } as unknown as RunSubmission;
    expect(verifyRun({ submission, snippet: SNIPPET, token: TOKEN, now: 2_000_000 })).toMatchObject({
      ok: false,
      reason: "telemetry is missing",
    });
  });

  it("rejects a clientElapsedMs that disagrees with the intervals", () => {
    const submission = { ...realRun(120), clientElapsedMs: 10 };
    const result = verifyRun({ submission, snippet: SNIPPET, token: TOKEN, now: 2_000_000 });
    expect(result).toMatchObject({ ok: false, reason: /disagrees with the sum of intervals/ });
  });

  it("tolerates rounding in clientElapsedMs", () => {
    const submission = realRun(120);
    submission.clientElapsedMs += ELAPSED_TOLERANCE_MS - 1;
    expect(verifyRun({ submission, snippet: SNIPPET, token: TOKEN, now: at(submission) }).ok).toBe(true);
  });

  it("rejects a run claiming more time than has passed since the token was issued", () => {
    const submission = realRun(120);
    // Submitted immediately, but claiming a long run.
    const result = verifyRun({
      submission,
      snippet: SNIPPET,
      token: TOKEN,
      now: TOKEN.serverStartMs + 10,
    });
    expect(result).toMatchObject({ ok: false, reason: /more time than has passed/ });
  });

  it("rejects a token dated in the future", () => {
    const submission = realRun(120);
    const result = verifyRun({
      submission,
      snippet: SNIPPET,
      token: { ...TOKEN, serverStartMs: 5_000_000 },
      now: 1_000_000,
    });
    expect(result).toMatchObject({ ok: false, reason: /from the future/ });
  });

  it("rejects inhuman speed", () => {
    // One keystroke per millisecond is far past any human ceiling.
    const submission = realRun(1);
    const result = verifyRun({ submission, snippet: SNIPPET, token: TOKEN, now: at(submission) });

    expect(result).toMatchObject({ ok: false, reason: /exceeds the plausible maximum/ });
  });

  it("accepts a fast but human run just under the ceiling", () => {
    // ~200 WPM: fast, and exactly the kind of run that must not be thrown away.
    const stepMs = Math.ceil(60_000 / (200 * 5));
    const submission = realRun(stepMs);
    const result = verifyRun({ submission, snippet: SNIPPET, token: TOKEN, now: at(submission) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metrics.grossWpm).toBeLessThan(MAX_PLAUSIBLE_WPM);
  });

  it("rejects error offsets that move backwards", () => {
    const submission = { ...realRun(120), errorOffsets: [5, 2] };
    expect(verifyRun({ submission, snippet: SNIPPET, token: TOKEN, now: at(submission) }).ok).toBe(false);
  });

  it("counts errors from the offsets it was given", () => {
    const submission = { ...realRun(120), errorOffsets: [1, 4, 9] };
    const result = verifyRun({ submission, snippet: SNIPPET, token: TOKEN, now: at(submission) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Three errors must cost accuracy, without the client being asked its opinion.
    expect(result.metrics.accuracy).toBeLessThan(1);
    expect(result.metrics.netWpm).toBeLessThan(result.metrics.grossWpm);
  });

  it("does not flag a short run for uniform timing", () => {
    // This snippet is under the sample threshold, so the distribution checks
    // stay silent by design — short levels must not be flagged for being short.
    const submission = realRun(120);
    const result = verifyRun({ submission, snippet: SNIPPET, token: TOKEN, now: at(submission) });
    expect(result.ok && result.flags).toEqual([]);
  });

  it("flags machine-uniform timing on a long enough run, without rejecting it", () => {
    const long = normalizeSnippet(
      Array.from({ length: 6 }, (_, i) => `.row${i} {\n  color: red;\n}`).join("\n"),
    );
    const snippet = { id: "s1", billableLength: computeBillableLength(long), targetCode: long };
    const submission = runOn(long, 120);

    const result = verifyRun({ submission, snippet, token: TOKEN, now: at(submission) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Flagged, not rejected: suspicion is not proof, and the run is still stored.
    expect(result.flags).toContain("low-variance");
    expect(result.metrics.grossWpm).toBeGreaterThan(0);
  });

  it("does not flag an irregular run of the same length", () => {
    const long = normalizeSnippet(
      Array.from({ length: 6 }, (_, i) => `.row${i} {\n  color: red;\n}`).join("\n"),
    );
    const snippet = { id: "s1", billableLength: computeBillableLength(long), targetCode: long };
    const submission = runOn(long, 120, true);

    const result = verifyRun({ submission, snippet, token: TOKEN, now: at(submission) });
    expect(result.ok && result.flags).toEqual([]);
  });
});

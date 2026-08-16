import { describe, expect, it } from "vitest";
import { createRunStore, selectCursor, selectErrorNonce, selectPhase } from "./runStore";
import { inputsForSnippet } from "@/engine/keystroke";
import { computeBillableLength, normalizeSnippet } from "@/engine/layout";
import type { GameInput } from "@/types/game";

const CODE = normalizeSnippet(`.a {
  color: red;
}`);

const char = (c: string): GameInput => ({ kind: "char", char: c });
const BACKSPACE: GameInput = { kind: "backspace" };

describe("createRunStore", () => {
  it("starts idle with empty telemetry", () => {
    const store = createRunStore(CODE);
    const state = store.getState();

    expect(selectPhase(state)).toBe("IDLE");
    expect(state.telemetry.intervals).toEqual([]);
  });

  it("advances the reducer and the recorder together", () => {
    const store = createRunStore(CODE);
    store.getState().apply(char("."), 0);
    store.getState().apply(char("a"), 100);

    const state = store.getState();
    expect(selectCursor(state)).toBe(2);
    // Telemetry can never describe a run that did not happen.
    expect(state.telemetry.intervals).toEqual([0, 100]);
  });

  it("returns the effect so callers can drive sound and animation", () => {
    const store = createRunStore(CODE);
    expect(store.getState().apply(char("."), 0)).toBe("accepted");
    expect(store.getState().apply(char("x"), 100)).toBe("error");
    expect(store.getState().apply(char("y"), 200)).toBe("blocked");
    expect(store.getState().apply(BACKSPACE, 300)).toBe("unlocked");
  });

  it("bumps the error nonce on every error and every blocked key", () => {
    const store = createRunStore(CODE);
    store.getState().apply(char("x"), 0);
    expect(selectErrorNonce(store.getState())).toBe(1);

    // Mashing while locked must keep shaking, even though it is still one error.
    store.getState().apply(char("y"), 100);
    store.getState().apply(char("z"), 200);
    expect(selectErrorNonce(store.getState())).toBe(3);
    expect(store.getState().run.totalErrors).toBe(1);
  });

  it("does not bump the nonce on accepted keystrokes", () => {
    const store = createRunStore(CODE);
    store.getState().apply(char("."), 0);
    expect(selectErrorNonce(store.getState())).toBe(0);
  });

  it("notifies subscribers on each keystroke", () => {
    const store = createRunStore(CODE);
    const seen: number[] = [];
    const unsubscribe = store.subscribe((state) => seen.push(selectCursor(state)));

    store.getState().apply(char("."), 0);
    store.getState().apply(char("a"), 100);
    unsubscribe();

    expect(seen).toEqual([1, 2]);
  });

  it("completes a run with telemetry matching billableLength", () => {
    const store = createRunStore(CODE);
    inputsForSnippet(CODE).forEach((input, i) => store.getState().apply(input, i * 100));

    const state = store.getState();
    expect(selectPhase(state)).toBe("FINISHED");
    // The invariant the submit endpoint checks (§4.6).
    expect(state.telemetry.intervals).toHaveLength(computeBillableLength(CODE));
  });

  it("resets to a fresh run, keeping no trace of the last one", () => {
    const store = createRunStore(CODE);
    inputsForSnippet(CODE).forEach((input, i) => store.getState().apply(input, i * 100));
    store.getState().apply(char("x"), 9_999);

    store.getState().reset();
    const state = store.getState();

    expect(selectPhase(state)).toBe("IDLE");
    expect(selectCursor(state)).toBe(0);
    expect(selectErrorNonce(state)).toBe(0);
    expect(state.telemetry).toEqual({ intervals: [], errorOffsets: [], lastAt: null });
  });

  it("keeps two stores independent", () => {
    const first = createRunStore(CODE);
    const second = createRunStore(CODE);

    first.getState().apply(char("."), 0);

    // A remount after finishing must not inherit the previous run's keystrokes.
    expect(selectCursor(second.getState())).toBe(0);
  });
});

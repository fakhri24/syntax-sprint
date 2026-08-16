import { describe, expect, it } from "vitest";
import {
  applyInput,
  applyInputs,
  createRunState,
  inputsForSnippet,
  runElapsedMs,
  type RunState,
} from "./keystroke";
import { computeBillableLength, normalizeSnippet } from "./layout";
import type { GameInput } from "@/types/game";

const CSS = normalizeSnippet(`.a {
  color: red;
}`);

const char = (c: string): GameInput => ({ kind: "char", char: c });
const ENTER: GameInput = { kind: "enter" };
const BACKSPACE: GameInput = { kind: "backspace" };

/** Applies inputs and returns every step, so effects can be asserted in order. */
function trace(code: string, inputs: GameInput[], state = createRunState(code)) {
  const effects: string[] = [];
  let current = state;
  inputs.forEach((input, i) => {
    const step = applyInput(current, input, code, i * 100);
    current = step.state;
    effects.push(step.effect);
  });
  return { state: current, effects };
}

describe("createRunState", () => {
  it("starts idle at the first typable character", () => {
    const state = createRunState("  ab");
    expect(state.cursorIndex).toBe(2);
    expect(state.clock.phase).toBe("IDLE");
    expect(state.hasError).toBe(false);
    expect(state.totalErrors).toBe(0);
  });
});

describe("correct typing", () => {
  it("advances the cursor and counts keystrokes", () => {
    const { state, effects } = trace(CSS, [char("."), char("a")]);
    expect(state.cursorIndex).toBe(2);
    expect(state.correctKeystrokes).toBe(2);
    expect(effects).toEqual(["accepted", "accepted"]);
  });

  it("starts the clock on the first keystroke, not on mount", () => {
    const idle = createRunState(CSS);
    expect(runElapsedMs(idle, 5_000)).toBe(0);

    const started = applyInput(idle, char("."), CSS, 1_000).state;
    expect(started.clock.phase).toBe("RUNNING");
    expect(started.clock.startedAt).toBe(1_000);
    expect(runElapsedMs(started, 1_250)).toBe(250);
  });

  it("takes Enter at end-of-line and lands past the indentation", () => {
    const state = applyInputs(createRunState(CSS), [char("."), char("a"), char(" "), char("{")], CSS);
    const afterEnter = applyInput(state, ENTER, CSS, 500).state;

    expect(CSS[afterEnter.cursorIndex]).toBe("c");
    expect(afterEnter.correctKeystrokes).toBe(5);
  });

  it("completes a whole snippet in exactly billableLength inputs", () => {
    const inputs = inputsForSnippet(CSS);
    expect(inputs).toHaveLength(computeBillableLength(CSS));

    const { state, effects } = trace(CSS, inputs);
    expect(state.clock.phase).toBe("FINISHED");
    expect(state.correctKeystrokes).toBe(computeBillableLength(CSS));
    expect(state.totalErrors).toBe(0);
    expect(effects.at(-1)).toBe("completed");
    expect(effects.filter((e) => e !== "accepted" && e !== "completed")).toEqual([]);
  });

  it("freezes elapsed time at the final keystroke", () => {
    const inputs = inputsForSnippet(CSS);
    const state = applyInputs(createRunState(CSS), inputs, CSS, 0, 100);
    const frozen = runElapsedMs(state, 999_999);
    expect(frozen).toBe((inputs.length - 1) * 100);
  });
});

describe("hard lock", () => {
  it("engages on a wrong character without advancing the cursor", () => {
    const { state, effects } = trace(CSS, [char("x")]);
    expect(effects).toEqual(["error"]);
    expect(state.hasError).toBe(true);
    expect(state.errorChar).toBe("x");
    expect(state.cursorIndex).toBe(0);
    expect(state.correctKeystrokes).toBe(0);
    expect(state.totalErrors).toBe(1);
  });

  it("blocks every input except Backspace while locked", () => {
    const { state, effects } = trace(CSS, [char("x"), char("."), char("a"), ENTER]);
    expect(effects).toEqual(["error", "blocked", "blocked", "blocked"]);
    expect(state.cursorIndex).toBe(0);
    expect(state.correctKeystrokes).toBe(0);
  });

  it("counts one error however long the player mashes (§4.3)", () => {
    const mashing = Array.from({ length: 20 }, () => char("z"));
    const { state } = trace(CSS, [char("x"), ...mashing]);

    expect(state.totalErrors).toBe(1);
    expect(state.blockedKeystrokes).toBe(20);
  });

  it("unlocks only on Backspace, and resumes forward progress", () => {
    const { state, effects } = trace(CSS, [char("x"), BACKSPACE, char(".")]);
    expect(effects).toEqual(["error", "unlocked", "accepted"]);
    expect(state.hasError).toBe(false);
    expect(state.errorChar).toBe(null);
    expect(state.cursorIndex).toBe(1);
  });

  it("never lets a second error character exist", () => {
    const { state } = trace(CSS, [char("x"), char("y")]);
    expect(state.errorChar).toBe("x");
    expect(state.totalErrors).toBe(1);
  });

  it("treats a character typed at end-of-line as an error", () => {
    const upToEol = [char("."), char("a"), char(" "), char("{")];
    const { state, effects } = trace(CSS, [...upToEol, char(";")]);

    expect(effects.at(-1)).toBe("error");
    expect(state.errorChar).toBe(";");
    expect(state.totalErrors).toBe(1);
  });

  it("treats Enter typed mid-line as an error, recorded as a newline", () => {
    const { state, effects } = trace(CSS, [char("."), ENTER]);
    expect(effects.at(-1)).toBe("error");
    expect(state.errorChar).toBe("\n");
  });

  it("starts the clock even when the first input is wrong", () => {
    const state = applyInput(createRunState(CSS), char("x"), CSS, 2_000).state;
    expect(state.clock.phase).toBe("RUNNING");
    expect(state.clock.startedAt).toBe(2_000);
  });
});

describe("backspace when unlocked", () => {
  it("is a no-op and cannot delete a correct character", () => {
    const typed = applyInputs(createRunState(CSS), [char("."), char("a")], CSS);
    const { state, effects } = trace(CSS, [BACKSPACE, BACKSPACE, BACKSPACE], typed);

    expect(effects).toEqual(["noop", "noop", "noop"]);
    expect(state.cursorIndex).toBe(2);
    expect(state.correctKeystrokes).toBe(2);
  });

  it("does not count toward errors or blocked keystrokes", () => {
    const { state } = trace(CSS, [BACKSPACE, BACKSPACE]);
    expect(state.totalErrors).toBe(0);
    expect(state.blockedKeystrokes).toBe(0);
  });

  it("does not start the clock on its own", () => {
    const { state } = trace(CSS, [BACKSPACE]);
    expect(state.clock.phase).toBe("IDLE");
  });

  it("clears the error without touching the counters", () => {
    const { state } = trace(CSS, [char("x"), BACKSPACE]);
    expect(state.totalErrors).toBe(1);
    expect(state.blockedKeystrokes).toBe(0);
    expect(state.correctKeystrokes).toBe(0);
  });
});

describe("finished runs", () => {
  function completed(): RunState {
    return applyInputs(createRunState(CSS), inputsForSnippet(CSS), CSS);
  }

  it("ignores all further input", () => {
    const state = completed();
    for (const input of [char("x"), ENTER, BACKSPACE]) {
      const step = applyInput(state, input, CSS, 10_000);
      expect(step.effect).toBe("noop");
      expect(step.state).toBe(state);
    }
  });

  it("cannot be restarted in place", () => {
    const state = completed();
    expect(state.clock.phase).toBe("FINISHED");
    expect(applyInput(state, char("."), CSS, 1).state.correctKeystrokes).toBe(state.correctKeystrokes);
  });
});

describe("multiline indentation", () => {
  const NESTED = normalizeSnippet(`a {
  b {
        c: 1;
  }
}`);

  it("never asks the player to type indentation, however deep", () => {
    const inputs = inputsForSnippet(NESTED);
    expect(inputs.some((i) => i.kind === "char" && i.char === " " )).toBe(true); // spaces inside lines exist
    const { state } = trace(NESTED, inputs);
    expect(state.clock.phase).toBe("FINISHED");
    expect(state.totalErrors).toBe(0);
  });

  it("skips blank lines with one Enter", () => {
    const code = normalizeSnippet("a\n\n\nb");
    const { state, effects } = trace(code, [char("a"), ENTER, char("b")]);
    expect(effects).toEqual(["accepted", "accepted", "completed"]);
    expect(state.correctKeystrokes).toBe(3);
  });
});

describe("state immutability", () => {
  it("never mutates the input state", () => {
    const state = createRunState(CSS);
    const snapshot = JSON.stringify(state);
    applyInput(state, char("x"), CSS, 0);
    applyInput(state, char("."), CSS, 0);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

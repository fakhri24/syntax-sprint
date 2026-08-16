/**
 * Hard-lock keystroke engine (AGENTS.md §4.3).
 *
 * A wrong character halts the cursor. Only Backspace unlocks it. At most one
 * error character can ever exist, because the lock engages on the first wrong
 * input — so a second wrong character can never be entered. When unlocked,
 * Backspace is a no-op: correct characters are not deletable and cursor
 * progress is strictly monotonic.
 *
 * A pure reducer, so the whole game loop is testable without a DOM.
 */
import { advanceAfterEnter, expectedInputAt, initialCursor, typablePositions } from "./layout";
import { elapsedMs, finishClock, idleClock, isActive, startClock, type RunClock } from "./fsm";
import type { GameInput, KeystrokeState } from "@/types/game";

export interface RunState extends KeystrokeState {
  clock: RunClock;
}

export type KeystrokeEffect =
  /** Cursor advanced. */
  | "accepted"
  /** Cursor advanced and the snippet is complete. */
  | "completed"
  /** Wrong input: the lock just engaged. Counted in totalErrors. */
  | "error"
  /** Input arrived while locked. Shake and sound again, but not a new error. */
  | "blocked"
  /** Backspace cleared the error. */
  | "unlocked"
  /** Nothing happened: Backspace with nothing to delete, or input after the run ended. */
  | "noop";

export interface RunStep {
  state: RunState;
  effect: KeystrokeEffect;
}

export function createRunState(code: string): RunState {
  return {
    cursorIndex: initialCursor(code),
    correctKeystrokes: 0,
    hasError: false,
    errorChar: null,
    totalErrors: 0,
    blockedKeystrokes: 0,
    clock: idleClock(),
  };
}

/** The character an input represents, for error reporting. */
function inputChar(input: GameInput): string {
  return input.kind === "char" ? input.char : "\n";
}

/**
 * Applies one normalized input. `now` is only read when the clock changes, so
 * callers may pass `performance.now()` freely.
 */
export function applyInput(state: RunState, input: GameInput, code: string, now: number): RunStep {
  if (state.clock.phase === "FINISHED") {
    return { state, effect: "noop" };
  }

  // --- Locked: only Backspace gets through (§4.3) ---
  if (state.hasError) {
    if (input.kind === "backspace") {
      return {
        state: { ...state, hasError: false, errorChar: null },
        effect: "unlocked",
      };
    }
    // Every additional keypress re-triggers shake and sound, but one typo is one
    // error however long the player mashes.
    return {
      state: { ...state, blockedKeystrokes: state.blockedKeystrokes + 1 },
      effect: "blocked",
    };
  }

  // --- Unlocked Backspace is a no-op: correct characters are not deletable ---
  if (input.kind === "backspace") {
    return { state, effect: "noop" };
  }

  const clock = isActive(state.clock) ? state.clock : startClock(state.clock, now);
  const expected = expectedInputAt(code, state.cursorIndex);

  const matches =
    expected === "enter"
      ? input.kind === "enter"
      : input.kind === "char" && input.char === code[state.cursorIndex];

  if (!matches) {
    return {
      state: {
        ...state,
        clock,
        hasError: true,
        errorChar: inputChar(input),
        totalErrors: state.totalErrors + 1,
      },
      effect: "error",
    };
  }

  const nextIndex =
    expected === "enter" ? advanceAfterEnter(code, state.cursorIndex) : state.cursorIndex + 1;
  const done = expectedInputAt(code, nextIndex) === "done";

  return {
    state: {
      ...state,
      clock: done ? finishClock(clock, now) : clock,
      cursorIndex: nextIndex,
      correctKeystrokes: state.correctKeystrokes + 1,
    },
    effect: done ? "completed" : "accepted",
  };
}

/** Convenience for tests and replays. */
export function applyInputs(
  state: RunState,
  inputs: GameInput[],
  code: string,
  startNow = 0,
  stepMs = 100,
): RunState {
  return inputs.reduce(
    (current, input, i) => applyInput(current, input, code, startNow + i * stepMs).state,
    state,
  );
}

/**
 * The exact input sequence that types a snippet correctly. Derived from the
 * layout traversal, so it never includes auto-skipped indentation. Its length
 * is `billableLength` by construction.
 */
export function inputsForSnippet(code: string): GameInput[] {
  return typablePositions(code).map((index) =>
    code[index] === "\n" ? ({ kind: "enter" } as const) : ({ kind: "char", char: code[index] } as const),
  );
}

export function runElapsedMs(state: RunState, now: number): number {
  return elapsedMs(state.clock, now);
}

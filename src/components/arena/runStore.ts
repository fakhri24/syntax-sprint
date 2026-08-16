import { createStore } from "zustand";
import { applyInput, createRunState, type KeystrokeEffect, type RunState } from "@/engine/keystroke";
import { createTelemetry, recordStep, type TelemetryState } from "@/engine/telemetry";
import type { GameInput } from "@/types/game";

/**
 * Run state for one arena (AGENTS.md §2).
 *
 * A store rather than component state so the keystroke path is not a React
 * render: the editor subscribes to the cursor alone, the stage to the cursor
 * alone, and the speedometer to nothing at all — it reads `getState()` inside
 * its animation frame (§4.11).
 *
 * One store per mount, not a module singleton: two arenas on a page, or a
 * remount after finishing, must not inherit a previous run's keystrokes.
 */
export interface RunStoreState {
  code: string;
  run: RunState;
  telemetry: TelemetryState;
  /** Bumped on every error and every blocked keypress, to replay the shake. */
  errorNonce: number;
  apply: (input: GameInput, now: number) => KeystrokeEffect;
  reset: () => void;
}

export function createRunStore(code: string) {
  return createStore<RunStoreState>((set, get) => ({
    code,
    run: createRunState(code),
    telemetry: createTelemetry(),
    errorNonce: 0,

    apply(input, now) {
      const { code: target, run, telemetry, errorNonce } = get();
      const step = applyInput(run, input, target, now);

      // The reducer and the recorder advance together, so telemetry can never
      // describe a run that did not happen.
      set({
        run: step.state,
        telemetry: recordStep(telemetry, step, now),
        errorNonce:
          step.effect === "error" || step.effect === "blocked" ? errorNonce + 1 : errorNonce,
      });

      return step.effect;
    },

    reset() {
      set({
        run: createRunState(get().code),
        telemetry: createTelemetry(),
        errorNonce: 0,
      });
    },
  }));
}

export type RunStoreApi = ReturnType<typeof createRunStore>;

/** Selectors, kept here so every subscriber narrows the same way. */
export const selectCursor = (state: RunStoreState) => state.run.cursorIndex;
export const selectHasError = (state: RunStoreState) => state.run.hasError;
export const selectErrorNonce = (state: RunStoreState) => state.errorNonce;
export const selectPhase = (state: RunStoreState) => state.run.clock.phase;

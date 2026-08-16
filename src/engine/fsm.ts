/**
 * Run lifecycle and clock (AGENTS.md §4.3).
 *
 * IDLE -> RUNNING -> FINISHED, one way only. The clock starts on the first
 * keystroke, not when the arena mounts, so a player is never charged for the
 * time spent reading the snippet.
 */
import type { GamePhase } from "@/types/game";

export interface RunClock {
  phase: GamePhase;
  /** Timestamp of the first keystroke. */
  startedAt: number | null;
  finishedAt: number | null;
}

export function idleClock(): RunClock {
  return { phase: "IDLE", startedAt: null, finishedAt: null };
}

export function startClock(clock: RunClock, now: number): RunClock {
  if (clock.phase !== "IDLE") {
    throw new Error(`cannot start a run from phase ${clock.phase}`);
  }
  return { phase: "RUNNING", startedAt: now, finishedAt: null };
}

export function finishClock(clock: RunClock, now: number): RunClock {
  if (clock.phase !== "RUNNING") {
    throw new Error(`cannot finish a run from phase ${clock.phase}`);
  }
  return { ...clock, phase: "FINISHED", finishedAt: now };
}

/** True while the run accepts input. */
export function isActive(clock: RunClock): boolean {
  return clock.phase === "RUNNING";
}

/**
 * Elapsed time in milliseconds. Zero before the first keystroke; frozen at the
 * final keystroke once finished, so a slow completion modal cannot inflate it.
 */
export function elapsedMs(clock: RunClock, now: number): number {
  if (clock.startedAt === null) return 0;
  return (clock.finishedAt ?? now) - clock.startedAt;
}

/**
 * Device gating for the arena (AGENTS.md §4.9).
 *
 * The game needs a physical keyboard, and **no web API reports whether one is
 * attached.** Everything below is a proxy: a fine pointer usually means a mouse
 * or trackpad, and a wide viewport usually means a laptop. Both are wrong
 * sometimes — which is precisely why §4.9 requires an escape hatch rather than
 * treating this as a verdict.
 */

/** Below this, the split-screen arena has nowhere to put the stage. */
export const MIN_ARENA_WIDTH = 1024;

export interface DeviceSignals {
  /** `(any-pointer: fine)` — a mouse, trackpad, or stylus is available. */
  hasFinePointer: boolean;
  viewportWidth: number;
}

export type GateReason = "no-fine-pointer" | "viewport-too-narrow" | null;

/** Why the arena would be gated, or null if it would not be. */
export function gateReason({ hasFinePointer, viewportWidth }: DeviceSignals): GateReason {
  if (!hasFinePointer) return "no-fine-pointer";
  if (viewportWidth < MIN_ARENA_WIDTH) return "viewport-too-narrow";
  return null;
}

export function requiresDesktopGate(signals: DeviceSignals): boolean {
  return gateReason(signals) !== null;
}

export const GATE_MESSAGES: Record<NonNullable<GateReason>, string> = {
  "no-fine-pointer":
    "This device looks like it has no physical keyboard. Syntax Sprint is a typing game, so the arena needs one.",
  "viewport-too-narrow":
    "This window is too narrow for the split-screen arena. Widen it, or switch to a larger screen.",
};

/**
 * Reads the signals from the browser. Returns null on the server, where neither
 * signal exists — callers must treat that as "not yet known" rather than
 * assuming either answer, or the page will hydrate into the wrong state.
 */
export function readDeviceSignals(): DeviceSignals | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return {
    hasFinePointer: window.matchMedia("(any-pointer: fine)").matches,
    viewportWidth: window.innerWidth,
  };
}

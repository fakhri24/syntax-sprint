/**
 * Per-character render state transitions for the editor viewport (AGENTS.md §4.11).
 *
 * Extracted as pure functions so the update rule is testable without layout.
 * The component applies the returned mutations imperatively against a ref array
 * — a keystroke must never re-render the snippet.
 */
import type { CharState } from "@/types/game";

export interface CursorSnapshot {
  cursorIndex: number;
  hasError: boolean;
}

export interface CharMutation {
  index: number;
  state: CharState;
}

/** The state every character starts in, built once at mount. */
export function initialCharStates(skipMask: boolean[]): CharState[] {
  return skipMask.map((skipped) => (skipped ? "skipped" : "pending"));
}

/**
 * The minimal set of character states that changed between two cursor snapshots.
 *
 * Usually one or two entries. An Enter can move the cursor several characters at
 * once, but the auto-skipped indentation it passes over keeps its `skipped`
 * state — only the newline itself becomes `typed`.
 */
export function diffCharStates(
  previous: CursorSnapshot,
  next: CursorSnapshot,
  skipMask: boolean[],
): CharMutation[] {
  const mutations: CharMutation[] = [];

  for (let index = previous.cursorIndex; index < next.cursorIndex; index += 1) {
    if (!skipMask[index]) mutations.push({ index, state: "typed" });
  }

  const cursorMoved = previous.cursorIndex !== next.cursorIndex;
  const errorChanged = previous.hasError !== next.hasError;

  // The character under the cursor is the only one that carries the error state.
  if ((cursorMoved || errorChanged) && next.cursorIndex < skipMask.length) {
    mutations.push({ index: next.cursorIndex, state: next.hasError ? "error" : "pending" });
  }

  return mutations;
}

/**
 * Colour lookup per character, expanded once from the token list so the render
 * loop never searches. Characters outside every token inherit the default.
 */
export function expandTokenColors(
  length: number,
  tokens: Array<{ start: number; end: number; light: string; dark: string }>,
): Array<{ light: string; dark: string } | null> {
  const colors = new Array<{ light: string; dark: string } | null>(length).fill(null);
  for (const { start, end, light, dark } of tokens) {
    for (let index = Math.max(0, start); index < Math.min(end, length); index += 1) {
      colors[index] = { light, dark };
    }
  }
  return colors;
}

import { describe, expect, it } from "vitest";
import { diffCharStates, expandTokenColors, initialCharStates } from "./charStates";
import { buildLayout, normalizeSnippet } from "@/engine/layout";

const CSS = normalizeSnippet(`.a {
  color: red;
}`);

describe("initialCharStates", () => {
  it("marks auto-skipped indentation and leaves the rest pending", () => {
    const { skipMask } = buildLayout("a\n  b");
    expect(initialCharStates(skipMask)).toEqual(["pending", "pending", "skipped", "skipped", "pending"]);
  });

  it("has one entry per character", () => {
    const { skipMask } = buildLayout(CSS);
    expect(initialCharStates(skipMask)).toHaveLength(CSS.length);
  });
});

describe("diffCharStates", () => {
  const { skipMask } = buildLayout(CSS);

  it("marks the character just passed as typed and the new one as current", () => {
    expect(diffCharStates({ cursorIndex: 0, hasError: false }, { cursorIndex: 1, hasError: false }, skipMask)).toEqual([
      { index: 0, state: "typed" },
      { index: 1, state: "current" },
    ]);
  });

  it("emits nothing when nothing changed", () => {
    const snapshot = { cursorIndex: 3, hasError: false };
    expect(diffCharStates(snapshot, snapshot, skipMask)).toEqual([]);
  });

  it("keeps skipped indentation skipped when Enter jumps over it", () => {
    const code = "a\n    b";
    const mask = buildLayout(code).skipMask;
    // Enter at index 1 lands on index 6, passing over four indent spaces.
    const mutations = diffCharStates({ cursorIndex: 1, hasError: false }, { cursorIndex: 6, hasError: false }, mask);

    expect(mutations).toEqual([
      { index: 1, state: "typed" }, // the newline itself was typed
      { index: 6, state: "current" },
    ]);
  });

  it("moves only the character under the cursor into the error state", () => {
    expect(diffCharStates({ cursorIndex: 2, hasError: false }, { cursorIndex: 2, hasError: true }, skipMask)).toEqual([
      { index: 2, state: "error" },
    ]);
  });

  it("clears the error in place when Backspace unlocks", () => {
    expect(diffCharStates({ cursorIndex: 2, hasError: true }, { cursorIndex: 2, hasError: false }, skipMask)).toEqual([
      { index: 2, state: "current" },
    ]);
  });

  it("emits nothing for the cursor when the run has finished past the last character", () => {
    const mutations = diffCharStates(
      { cursorIndex: CSS.length - 1, hasError: false },
      { cursorIndex: CSS.length, hasError: false },
      skipMask,
    );
    expect(mutations).toEqual([{ index: CSS.length - 1, state: "typed" }]);
  });

  it("stays small — a keystroke never touches more than a couple of spans", () => {
    for (let i = 0; i < CSS.length - 1; i += 1) {
      const mutations = diffCharStates(
        { cursorIndex: i, hasError: false },
        { cursorIndex: i + 1, hasError: false },
        skipMask,
      );
      expect(mutations.length).toBeLessThanOrEqual(2);
    }
  });
});

describe("expandTokenColors", () => {
  it("expands token ranges to a per-character lookup", () => {
    const colors = expandTokenColors(5, [{ start: 1, end: 3, light: "#111", dark: "#eee" }]);
    expect(colors).toEqual([
      null,
      { light: "#111", dark: "#eee" },
      { light: "#111", dark: "#eee" },
      null,
      null,
    ]);
  });

  it("clamps token ranges that overrun the code", () => {
    const colors = expandTokenColors(2, [{ start: 0, end: 99, light: "#111", dark: "#eee" }]);
    expect(colors).toHaveLength(2);
    expect(colors.every((c) => c !== null)).toBe(true);
  });

  it("returns all nulls when there are no tokens", () => {
    expect(expandTokenColors(3, [])).toEqual([null, null, null]);
  });
});

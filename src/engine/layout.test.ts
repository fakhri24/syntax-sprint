import { describe, expect, it } from "vitest";
import {
  advanceAfterEnter,
  buildLayout,
  buildSkipMask,
  computeBillableLength,
  expectedInputAt,
  initialCursor,
  normalizeSnippet,
  skipToNextTypable,
  validateSnippet,
} from "./layout";

// Fixtures named in PLAN Task 1.3.
const NESTED_CSS = normalizeSnippet(`.rocket {
  transform: translateY(0);
  filter: blur(0px);
}`);

const SVG_ATTRS = normalizeSnippet(`<svg viewBox="0 0 24 24">
  <path
    d="M12 2L2 22h20Z"
    fill="currentColor"
  />
</svg>`);

const JS_BLANK_LINES = normalizeSnippet(`const card = document.querySelector(".card");

function activate() {
  card.classList.add("is-active");
}

card.addEventListener("click", activate);`);

describe("normalizeSnippet", () => {
  it("converts CRLF and lone CR to LF", () => {
    expect(normalizeSnippet("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("strips trailing whitespace from every line", () => {
    expect(normalizeSnippet("a   \n  b\t\nc")).toBe("a\n  b\nc");
  });

  it("drops trailing newlines so no final Enter is demanded", () => {
    expect(normalizeSnippet("a\nb\n\n\n")).toBe("a\nb");
  });

  it("is idempotent", () => {
    for (const code of [NESTED_CSS, SVG_ATTRS, JS_BLANK_LINES]) {
      expect(normalizeSnippet(code)).toBe(code);
    }
  });
});

describe("validateSnippet", () => {
  it("accepts the curated fixtures", () => {
    for (const code of [NESTED_CSS, SVG_ATTRS, JS_BLANK_LINES]) {
      expect(validateSnippet(code)).toEqual([]);
    }
  });

  it("rejects an unnormalized snippet rather than silently rewriting it", () => {
    expect(validateSnippet("a  \nb")).toContain("not normalized — run normalizeSnippet() before seeding");
  });

  it("allows leading tabs but rejects a tab inside a line", () => {
    expect(validateSnippet("a {\n\tcolor: red;\n}")).toEqual([]);
    expect(validateSnippet("const a =\tb;")).toContain("line 1: tab inside the line; use spaces");
  });

  it("rejects an empty snippet", () => {
    expect(validateSnippet("")).toContain("snippet is empty");
  });
});

describe("cursor traversal", () => {
  it("starts past the indentation of an indented first line", () => {
    expect(initialCursor("    .a {}")).toBe(4);
    expect(initialCursor(NESTED_CSS)).toBe(0);
  });

  it("skips the next line's indentation on Enter", () => {
    const newline = NESTED_CSS.indexOf("\n");
    // Lands on 't' of transform, not on the two leading spaces.
    expect(NESTED_CSS[advanceAfterEnter(NESTED_CSS, newline)]).toBe("t");
  });

  it("skips several blank lines with a single Enter", () => {
    const code = "a\n\n\n\nb";
    expect(advanceAfterEnter(code, 1)).toBe(code.indexOf("b"));
  });

  it("skips a blank line and the following indentation together", () => {
    const code = "a\n\n    b";
    expect(advanceAfterEnter(code, 1)).toBe(code.indexOf("b"));
  });

  it("lands at the end when nothing typable remains", () => {
    const code = "a\n   ";
    expect(advanceAfterEnter(code, 1)).toBe(code.length);
  });

  it("refuses to resolve an Enter that is not at a newline", () => {
    expect(() => advanceAfterEnter("abc", 1)).toThrow(/not a newline/);
  });

  it("skipToNextTypable is a no-op when already on a typable character", () => {
    expect(skipToNextTypable("abc", 1)).toBe(1);
  });
});

describe("expectedInputAt", () => {
  it("demands Enter at end-of-line and reports completion at the end", () => {
    const code = "ab\ncd";
    expect(expectedInputAt(code, 0)).toBe("char");
    expect(expectedInputAt(code, 2)).toBe("enter");
    expect(expectedInputAt(code, 3)).toBe("char");
    expect(expectedInputAt(code, 5)).toBe("done");
  });
});

describe("computeBillableLength", () => {
  it("counts a newline once and indentation not at all", () => {
    // "a", Enter, "b" — the four indent spaces are free.
    expect(computeBillableLength("a\n    b")).toBe(3);
  });

  it("charges one Enter for a run of blank lines", () => {
    expect(computeBillableLength("a\n\n\nb")).toBe(3);
  });

  it("ignores leading whitespace on the first line", () => {
    expect(computeBillableLength("  ab")).toBe(2);
  });

  it("is zero for whitespace-only input", () => {
    expect(computeBillableLength("   \n  \n")).toBe(0);
  });

  it("does not inflate with indentation depth", () => {
    const shallow = normalizeSnippet("a {\n  b: 1;\n}");
    const deep = normalizeSnippet("a {\n          b: 1;\n}");
    expect(computeBillableLength(deep)).toBe(computeBillableLength(shallow));
  });

  it("matches a hand count on the nested CSS fixture", () => {
    // ".rocket {" 9 + Enter + "transform: translateY(0);" 25 + Enter
    // + "filter: blur(0px);" 18 + Enter + "}" 1
    expect(computeBillableLength(NESTED_CSS)).toBe(9 + 1 + 25 + 1 + 18 + 1 + 1);
  });

  it("handles the SVG attribute block", () => {
    const lines = SVG_ATTRS.split("\n");
    const expected =
      lines.reduce((sum, line) => sum + line.trim().length, 0) + (lines.length - 1);
    expect(computeBillableLength(SVG_ATTRS)).toBe(expected);
  });

  it("handles JS with blank lines between functions", () => {
    const lines = JS_BLANK_LINES.split("\n");
    const nonBlank = lines.filter((line) => line.trim() !== "");
    const characters = nonBlank.reduce((sum, line) => sum + line.trim().length, 0);
    // One Enter per gap between non-blank lines, however many blanks are inside.
    expect(computeBillableLength(JS_BLANK_LINES)).toBe(characters + nonBlank.length - 1);
  });
});

describe("buildSkipMask", () => {
  it("marks leading whitespace as skipped and code as typable", () => {
    const code = "a\n  bc";
    expect(buildSkipMask(code)).toEqual([false, false, true, true, false, false]);
  });

  it("marks the newlines of blank lines as skipped, but not the first", () => {
    const code = "a\n\nb";
    //            0 1  2 3
    expect(buildSkipMask(code)).toEqual([false, false, true, false]);
  });

  it("has one entry per character", () => {
    expect(buildSkipMask(JS_BLANK_LINES)).toHaveLength(JS_BLANK_LINES.length);
  });

  it("agrees with computeBillableLength on every fixture", () => {
    for (const code of [NESTED_CSS, SVG_ATTRS, JS_BLANK_LINES, "a\n\n  b", "  x"]) {
      const typable = buildSkipMask(code).filter((skipped) => !skipped).length;
      expect(typable).toBe(computeBillableLength(code));
    }
  });
});

describe("buildLayout", () => {
  it("bundles the traversal results consistently", () => {
    const layout = buildLayout(NESTED_CSS);
    expect(layout.code).toBe(NESTED_CSS);
    expect(layout.startIndex).toBe(initialCursor(NESTED_CSS));
    expect(layout.skipMask).toHaveLength(NESTED_CSS.length);
    expect(layout.billableLength).toBe(computeBillableLength(NESTED_CSS));
  });

  it("walking the layout end to end consumes exactly billableLength inputs", () => {
    for (const code of [NESTED_CSS, SVG_ATTRS, JS_BLANK_LINES]) {
      const layout = buildLayout(code);
      let index = layout.startIndex;
      let inputs = 0;

      while (expectedInputAt(code, index) !== "done") {
        inputs += 1;
        index = expectedInputAt(code, index) === "enter" ? advanceAfterEnter(code, index) : index + 1;
      }

      // This is the invariant the submit endpoint checks (§4.6).
      expect(inputs).toBe(layout.billableLength);
    }
  });
});

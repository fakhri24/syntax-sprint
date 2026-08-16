import { describe, expect, it } from "vitest";
import { computeCheckpoints, latestCheckpointAt, validateJavaScript } from "./checkpoints";
import { normalizeSnippet } from "./layout";

const CARD = normalizeSnippet(`const card = document.querySelector(".card");

function activate() {
  card.classList.add("is-active");
}

card.addEventListener("click", activate);`);

describe("computeCheckpoints", () => {
  it("marks the end of each top-level statement", () => {
    const code = "const a = 1;\nconst b = 2;";
    expect(computeCheckpoints(code)).toEqual([12, 25]);
  });

  it("produces prefixes that all parse on their own", () => {
    for (const checkpoint of computeCheckpoints(CARD)) {
      expect(validateJavaScript(CARD.slice(0, checkpoint))).toEqual([]);
    }
  });

  it("does not treat a nested closing brace as a checkpoint", () => {
    const checkpoints = computeCheckpoints(CARD);
    const innerBrace = CARD.indexOf('card.classList.add("is-active");') + 32;

    // The `}` closing the function body is a checkpoint; the `;` inside it is not.
    expect(checkpoints).not.toContain(innerBrace);
    expect(checkpoints).toHaveLength(3);
  });

  it("handles a function declaration as one statement", () => {
    const code = "function f() {\n  return 1;\n}";
    expect(computeCheckpoints(code)).toEqual([code.length]);
  });

  it("handles statements without semicolons", () => {
    const code = "const a = 1\nconst b = 2";
    const checkpoints = computeCheckpoints(code);
    expect(checkpoints).toHaveLength(2);
    for (const checkpoint of checkpoints) {
      expect(validateJavaScript(code.slice(0, checkpoint))).toEqual([]);
    }
  });

  it("ends the last checkpoint at the end of the snippet", () => {
    expect(computeCheckpoints(CARD).at(-1)).toBe(CARD.length);
  });

  it("returns nothing for a comment-only snippet", () => {
    expect(computeCheckpoints("// nothing here")).toEqual([]);
  });
});

describe("latestCheckpointAt", () => {
  const checkpoints = [12, 25, 40];

  it("is zero before the first statement completes", () => {
    expect(latestCheckpointAt(checkpoints, 0)).toBe(0);
    expect(latestCheckpointAt(checkpoints, 11)).toBe(0);
  });

  it("returns the checkpoint exactly when the cursor reaches it", () => {
    expect(latestCheckpointAt(checkpoints, 12)).toBe(12);
  });

  it("holds the previous checkpoint while mid-statement", () => {
    expect(latestCheckpointAt(checkpoints, 13)).toBe(12);
    expect(latestCheckpointAt(checkpoints, 24)).toBe(12);
  });

  it("returns the last checkpoint at the end of the snippet", () => {
    expect(latestCheckpointAt(checkpoints, 999)).toBe(40);
  });

  it("is zero when a snippet has no checkpoints", () => {
    expect(latestCheckpointAt([], 50)).toBe(0);
  });

  it("changes value only at statement boundaries", () => {
    const code = CARD;
    const points = computeCheckpoints(code);
    const changes: number[] = [];
    let previous = 0;

    for (let cursor = 0; cursor <= code.length; cursor += 1) {
      const latest = latestCheckpointAt(points, cursor);
      if (latest !== previous) changes.push(cursor);
      previous = latest;
    }

    // The stage re-executes exactly as often as there are statements.
    expect(changes).toEqual(points);
  });
});

describe("validateJavaScript", () => {
  it("accepts a well-formed snippet", () => {
    expect(validateJavaScript(CARD)).toEqual([]);
  });

  it("rejects a snippet that cannot be parsed", () => {
    const problems = validateJavaScript("const a = ;");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/not parseable JavaScript/);
  });

  it("rejects a truncated snippet, which is why prefixes are not run blindly", () => {
    expect(validateJavaScript("function f() {")).toHaveLength(1);
  });
});

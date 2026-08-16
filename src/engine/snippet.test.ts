import { describe, expect, it } from "vitest";
import { SnippetBuildError, findDuplicateIds, prepareSnippet, validateManifest } from "./snippet";
import { computeBillableLength } from "./layout";
import { computeCheckpoints } from "./checkpoints";
import { MAX_BILLABLE_LENGTH } from "./telemetry";
import { SNIPPET_MANIFESTS } from "../../content/snippets";
import type { SnippetManifest } from "@/types/schema";

const base: SnippetManifest = {
  id: "test",
  title: "Test",
  difficulty: "easy",
  language: "css",
  targetCode: ".a {\n  color: red;\n}",
  initialStageHTML: '<div class="a"></div>',
  authorUid: "curated",
};

const manifest = (overrides: Partial<SnippetManifest> = {}): SnippetManifest => ({ ...base, ...overrides });

describe("validateManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(validateManifest(manifest())).toEqual([]);
  });

  it("validates against normalized code, not the raw authored text", () => {
    // Trailing whitespace would fail validateSnippet if checked raw, but the
    // pipeline strips it — an author should not be told off for it.
    expect(validateManifest(manifest({ targetCode: ".a {   \n  color: red;\n}\n\n" }))).toEqual([]);
  });

  it("reports empty required fields", () => {
    const problems = validateManifest(manifest({ id: "", title: " ", initialStageHTML: "" }));
    expect(problems).toContain("id is empty");
    expect(problems).toContain("title is empty");
    expect(problems).toContain("initialStageHTML is empty");
  });

  it("rejects a snippet with nothing to type", () => {
    expect(validateManifest(manifest({ targetCode: "   \n  " }))).toContain("snippet has nothing to type");
  });

  it("rejects unparseable JavaScript", () => {
    const problems = validateManifest(manifest({ language: "javascript", targetCode: "const a = ;" }));
    expect(problems.some((p) => p.includes("not parseable JavaScript"))).toBe(true);
  });

  it("does not parse-check CSS as JavaScript", () => {
    expect(validateManifest(manifest({ language: "css" }))).toEqual([]);
  });

  it("rejects a snippet over the payload cap", () => {
    const long = "a".repeat(MAX_BILLABLE_LENGTH + 1);
    expect(validateManifest(manifest({ targetCode: long }))).toContain(
      `billableLength ${MAX_BILLABLE_LENGTH + 1} exceeds the ${MAX_BILLABLE_LENGTH} cap (§4.6)`,
    );
  });

  it("reports a mid-line tab from the layout rules", () => {
    expect(validateManifest(manifest({ targetCode: "const a =\tb;" })).join()).toMatch(/tab inside the line/);
  });
});

describe("prepareSnippet", () => {
  it("normalizes the code it stores", () => {
    const snippet = prepareSnippet(manifest({ targetCode: ".a {\r\n  color: red;\r\n}\n" }), []);
    expect(snippet.targetCode).toBe(".a {\n  color: red;\n}");
  });

  it("derives billableLength from the same traversal the runtime uses", () => {
    const snippet = prepareSnippet(manifest(), []);
    expect(snippet.billableLength).toBe(computeBillableLength(snippet.targetCode));
  });

  it("computes checkpoints for JavaScript only", () => {
    const js = prepareSnippet(manifest({ language: "javascript", targetCode: "const a = 1;\nconst b = 2;" }), []);
    expect(js.checkpoints).toEqual(computeCheckpoints(js.targetCode));

    expect(prepareSnippet(manifest({ language: "css" }), []).checkpoints).toEqual([]);
    expect(prepareSnippet(manifest({ language: "svg", targetCode: "<path />" }), []).checkpoints).toEqual([]);
  });

  it("carries the supplied tokens through untouched", () => {
    const tokens = [{ start: 0, end: 2, light: "#111", dark: "#eee" }];
    expect(prepareSnippet(manifest(), tokens).tokens).toEqual(tokens);
  });

  it("throws with every problem at once rather than the first", () => {
    try {
      prepareSnippet(manifest({ id: "", title: "" }), []);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SnippetBuildError);
      expect((error as SnippetBuildError).problems.length).toBeGreaterThan(1);
    }
  });
});

describe("findDuplicateIds", () => {
  it("finds repeated ids", () => {
    expect(findDuplicateIds([manifest({ id: "a" }), manifest({ id: "b" }), manifest({ id: "a" })])).toEqual(["a"]);
  });

  it("is empty for unique ids", () => {
    expect(findDuplicateIds([manifest({ id: "a" }), manifest({ id: "b" })])).toEqual([]);
  });
});

describe("the curated levels", () => {
  it("ships three levels with unique ids", () => {
    expect(SNIPPET_MANIFESTS).toHaveLength(3);
    expect(findDuplicateIds(SNIPPET_MANIFESTS)).toEqual([]);
  });

  it("covers all three languages", () => {
    expect(SNIPPET_MANIFESTS.map((m) => m.language).sort()).toEqual(["css", "javascript", "svg"]);
  });

  it("all validate and build", () => {
    for (const item of SNIPPET_MANIFESTS) {
      expect(validateManifest(item), item.id).toEqual([]);
      expect(() => prepareSnippet(item, [])).not.toThrow();
    }
  });

  it("are typeable in a reasonable sitting", () => {
    for (const item of SNIPPET_MANIFESTS) {
      const billable = prepareSnippet(item, []).billableLength;
      expect(billable, item.id).toBeGreaterThan(20);
      expect(billable, item.id).toBeLessThan(400);
    }
  });

  it("gives the JavaScript level several checkpoints to pay off at", () => {
    const js = SNIPPET_MANIFESTS.find((m) => m.language === "javascript")!;
    expect(prepareSnippet(js, []).checkpoints.length).toBeGreaterThanOrEqual(3);
  });

  it("gives every level a stage to render into", () => {
    for (const item of SNIPPET_MANIFESTS) {
      expect(item.initialStageHTML, item.id).not.toBe("");
    }
    // The SVG level needs an <svg> root for the sink to resolve to.
    const svg = SNIPPET_MANIFESTS.find((m) => m.language === "svg")!;
    expect(svg.initialStageHTML).toContain("<svg");
  });
});

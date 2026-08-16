import { describe, expect, it } from "vitest";
import type { Snippet } from "./schema";

// Scaffolding smoke test: proves the Vitest + tsconfig alias + jsdom wiring works.
describe("scaffolding", () => {
  it("compiles and runs the schema types", () => {
    const snippet: Snippet = {
      id: "s1",
      title: "Rocket Launch",
      difficulty: "easy",
      language: "css",
      targetCode: ".rocket { opacity: 1; }",
      billableLength: 23,
      initialStageHTML: "<div class='rocket'></div>",
      checkpoints: [],
      tokens: [],
      authorUid: "seed",
    };
    expect(snippet.billableLength).toBe(23);
  });
});

/**
 * Turns an authored manifest into the document stored in Firestore
 * (AGENTS.md §4.8).
 *
 * Every derived field is computed here from the same engine functions the
 * runtime uses, which is what keeps `billableLength` and `checkpoints` from
 * drifting away from how the game actually behaves. Pure and Shiki-free — the
 * seed script supplies tokens — so the whole pipeline is testable offline.
 */
import { computeCheckpoints, validateJavaScript } from "./checkpoints";
import { computeBillableLength, normalizeSnippet, validateSnippet } from "./layout";
import { MAX_BILLABLE_LENGTH } from "./telemetry";
import type { HighlightToken, Snippet, SnippetManifest } from "@/types/schema";

export class SnippetBuildError extends Error {
  constructor(
    readonly snippetId: string,
    readonly problems: string[],
  ) {
    super(`${snippetId}: ${problems.join("; ")}`);
    this.name = "SnippetBuildError";
  }
}

/**
 * Authoring checks, run against the *normalized* code so an author is never
 * told off for whitespace the pipeline would have fixed anyway.
 */
export function validateManifest(manifest: SnippetManifest): string[] {
  const code = normalizeSnippet(manifest.targetCode);
  const problems = validateSnippet(code);

  if (!manifest.id.trim()) problems.push("id is empty");
  if (!manifest.title.trim()) problems.push("title is empty");
  if (!manifest.initialStageHTML.trim()) problems.push("initialStageHTML is empty");

  if (manifest.language === "javascript") {
    problems.push(...validateJavaScript(code));
  }

  const billableLength = computeBillableLength(code);
  if (billableLength === 0) {
    problems.push("snippet has nothing to type");
  }
  if (billableLength > MAX_BILLABLE_LENGTH) {
    problems.push(`billableLength ${billableLength} exceeds the ${MAX_BILLABLE_LENGTH} cap (§4.6)`);
  }

  return problems;
}

/** Builds the stored document, or throws with every problem at once. */
export function prepareSnippet(manifest: SnippetManifest, tokens: HighlightToken[]): Snippet {
  const problems = validateManifest(manifest);
  if (problems.length > 0) throw new SnippetBuildError(manifest.id, problems);

  const targetCode = normalizeSnippet(manifest.targetCode);

  return {
    id: manifest.id,
    title: manifest.title,
    difficulty: manifest.difficulty,
    language: manifest.language,
    targetCode,
    billableLength: computeBillableLength(targetCode),
    initialStageHTML: manifest.initialStageHTML,
    // Only JavaScript executes at statement boundaries; the declarative stages
    // inject on every keystroke and have no use for checkpoints (§4.4).
    checkpoints: manifest.language === "javascript" ? computeCheckpoints(targetCode) : [],
    tokens,
    authorUid: manifest.authorUid,
  };
}

/** Rejects duplicate ids before anything is written. */
export function findDuplicateIds(manifests: SnippetManifest[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { id } of manifests) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

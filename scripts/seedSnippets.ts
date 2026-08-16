/**
 * Seeds content/snippets/ into Firestore (AGENTS.md invariant #4, §4.10).
 *
 * This is the only writer for the `snippets` collection — clients are denied it
 * entirely, and the Admin SDK bypasses rules. Run with `npm run seed:snippets`;
 * add `--dry-run` to validate and report without writing anything.
 *
 * Shiki lives here rather than in src/: highlighting happens once, at seed time,
 * and must never reach a client bundle (§4.11).
 */
import { codeToTokens } from "shiki";
import { SNIPPET_MANIFESTS } from "../content/snippets";
import { flattenTokens, shikiLang } from "../src/engine/highlight";
import { SnippetBuildError, findDuplicateIds, prepareSnippet } from "../src/engine/snippet";
import { normalizeSnippet } from "../src/engine/layout";
import type { HighlightToken, Snippet, SnippetManifest } from "../src/types/schema";

const THEMES = { light: "github-light", dark: "github-dark" } as const;

async function highlight(manifest: SnippetManifest): Promise<HighlightToken[]> {
  const code = normalizeSnippet(manifest.targetCode);
  const { tokens } = await codeToTokens(code, {
    lang: shikiLang(manifest.language),
    themes: THEMES,
  });
  return flattenTokens(tokens, code);
}

async function build(): Promise<Snippet[]> {
  const duplicates = findDuplicateIds(SNIPPET_MANIFESTS);
  if (duplicates.length > 0) {
    throw new Error(`duplicate snippet ids: ${duplicates.join(", ")}`);
  }

  const snippets: Snippet[] = [];
  const failures: string[] = [];

  for (const manifest of SNIPPET_MANIFESTS) {
    try {
      snippets.push(prepareSnippet(manifest, await highlight(manifest)));
    } catch (error) {
      failures.push(
        error instanceof SnippetBuildError
          ? `${error.snippetId}\n    - ${error.problems.join("\n    - ")}`
          : `${manifest.id}\n    - ${(error as Error).message}`,
      );
    }
  }

  // Report every broken level in one pass; fixing them one run at a time is
  // needless friction for an authoring workflow.
  if (failures.length > 0) {
    throw new Error(`${failures.length} snippet(s) failed validation:\n  ${failures.join("\n  ")}`);
  }

  return snippets;
}

async function write(snippets: Snippet[]): Promise<void> {
  // Imported lazily so --dry-run never needs credentials.
  const { getAdminDb } = await import("../src/server/adminApp");
  const db = getAdminDb();

  // One batch: either every level is seeded or none is, so the collection is
  // never left half-updated.
  const batch = db.batch();
  for (const snippet of snippets) {
    batch.set(db.collection("snippets").doc(snippet.id), snippet);
  }
  await batch.commit();
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const snippets = await build();

  for (const snippet of snippets) {
    console.log(
      `✓ ${snippet.id.padEnd(18)} ${snippet.language.padEnd(11)} ` +
        `${String(snippet.billableLength).padStart(4)} billable  ` +
        `${String(snippet.tokens.length).padStart(3)} tokens  ` +
        `${snippet.checkpoints.length} checkpoints`,
    );
  }

  if (dryRun) {
    console.log(`\n${snippets.length} snippet(s) valid — nothing written (--dry-run)`);
    return;
  }

  await write(snippets);
  console.log(`\nseeded ${snippets.length} snippet(s) to Firestore`);
}

main().catch((error) => {
  console.error(`\n${(error as Error).message}`);
  process.exit(1);
});

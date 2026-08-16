/**
 * Flattens Shiki's per-line tokens into the offset-ranged list stored on a
 * snippet manifest (AGENTS.md §4.11).
 *
 * Kept separate from the seed script and free of any Shiki import so the
 * offset arithmetic — the part that can silently corrupt a whole level's
 * colours — is unit-testable on plain objects.
 */
import type { HighlightToken, Language } from "@/types/schema";

/** The subset of Shiki's `codeToTokens` output this depends on. */
export interface ShikiTokenLike {
  content: string;
  offset: number;
  htmlStyle?: Record<string, string>;
}

const DEFAULT_LIGHT = "#24292e";
const DEFAULT_DARK = "#e1e4e8";

export function flattenTokens(lines: ShikiTokenLike[][], code: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];

  for (const line of lines) {
    for (const token of line) {
      if (token.content.length === 0) continue;

      const start = token.offset;
      const end = start + token.content.length;

      // Offsets are absolute into the source. Verify rather than trust: a
      // mismatch here would tint the whole snippet wrongly and look like a
      // rendering bug rather than a seeding bug.
      if (code.slice(start, end) !== token.content) {
        throw new Error(
          `highlight: token at ${start} does not match the source ` +
            `(expected ${JSON.stringify(token.content)}, found ${JSON.stringify(code.slice(start, end))})`,
        );
      }

      tokens.push({
        start,
        end,
        light: token.htmlStyle?.color ?? DEFAULT_LIGHT,
        dark: token.htmlStyle?.["--shiki-dark"] ?? token.htmlStyle?.color ?? DEFAULT_DARK,
      });
    }
  }

  return tokens.sort((a, b) => a.start - b.start);
}

/**
 * Maps a snippet language to the Shiki grammar that highlights it. SVG has no
 * grammar of its own; XML is what actually colours its tags and attributes.
 */
export function shikiLang(language: Language): "css" | "xml" | "javascript" {
  return language === "svg" ? "xml" : language;
}

/**
 * Newline and indentation model (AGENTS.md §4.2).
 *
 * Users never type leading whitespace. A single Enter at end-of-line advances
 * past the newline, past the next line's indentation, and past any fully blank
 * lines. Auto-skipped characters are not typed, so they are never scored.
 *
 * Every function here is pure: the seed script uses them to precompute
 * `billableLength`, and the runtime uses the same traversal to move the cursor,
 * which is what guarantees `intervals.length === billableLength` at submit time
 * (§4.6).
 */

const isHorizontalSpace = (char: string | undefined) => char === " " || char === "\t";

/**
 * Canonicalizes authored source. Only safe, meaning-preserving edits happen
 * here; anything that would alter code semantics is reported by
 * `validateSnippet` instead of being silently rewritten.
 */
export function normalizeSnippet(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    // A trailing newline would demand a final Enter with nothing after it.
    .join("\n")
    .replace(/\n+$/, "");
}

/**
 * Seed-time authoring checks. Returns human-readable problems; an empty array
 * means the snippet is safe to publish.
 */
export function validateSnippet(code: string): string[] {
  const problems: string[] = [];

  if (code !== normalizeSnippet(code)) {
    problems.push("not normalized — run normalizeSnippet() before seeding");
  }
  if (code.trim() === "") {
    problems.push("snippet is empty");
  }

  code.split("\n").forEach((line, index) => {
    // Leading tabs are fine (they are auto-skipped), but a tab inside a line
    // would be a billable character that is ambiguous to type and to render.
    const body = line.replace(/^[ \t]*/, "");
    if (body.includes("\t")) {
      problems.push(`line ${index + 1}: tab inside the line; use spaces`);
    }
  });

  return problems;
}

/**
 * From `from`, skips horizontal whitespace and any fully blank lines, landing on
 * the next character the user must actually type (or `code.length`).
 */
export function skipToNextTypable(code: string, from: number): number {
  let index = from;
  for (;;) {
    while (isHorizontalSpace(code[index])) index += 1;
    if (code[index] === "\n") {
      index += 1;
      continue;
    }
    return index;
  }
}

/** Where the cursor starts: the first line may itself be indented. */
export function initialCursor(code: string): number {
  return skipToNextTypable(code, 0);
}

/**
 * Resolves an Enter press at `index`, which must point at a newline.
 * Advances past it, the next line's indentation, and any blank lines.
 */
export function advanceAfterEnter(code: string, index: number): number {
  if (code[index] !== "\n") {
    throw new Error(`advanceAfterEnter called at index ${index}, which is not a newline`);
  }
  return skipToNextTypable(code, index + 1);
}

export type ExpectedInput = "char" | "enter" | "done";

/** What the engine will accept at `index`. Anything else is an error (§4.3). */
export function expectedInputAt(code: string, index: number): ExpectedInput {
  if (index >= code.length) return "done";
  return code[index] === "\n" ? "enter" : "char";
}

/**
 * Walks the snippet exactly the way the cursor will at runtime, visiting only
 * billable positions. Shared by `computeBillableLength` and `buildSkipMask` so
 * the two can never disagree.
 */
export function typablePositions(code: string): number[] {
  const positions: number[] = [];
  let index = initialCursor(code);
  while (index < code.length) {
    positions.push(index);
    index = code[index] === "\n" ? advanceAfterEnter(code, index) : index + 1;
  }
  return positions;
}

/**
 * Characters the user actually types: `\n` counts as one (the Enter press),
 * leading whitespace counts as zero. This is the WPM denominator and the
 * expected `intervals.length` at submit time.
 */
export function computeBillableLength(code: string): number {
  return typablePositions(code).length;
}

/**
 * Per-character render mask: `true` means auto-skipped, which the editor renders
 * dimmed and never assigns a typing state (§4.11).
 */
export function buildSkipMask(code: string): boolean[] {
  const mask = new Array<boolean>(code.length).fill(true);
  for (const index of typablePositions(code)) mask[index] = false;
  return mask;
}

export interface SnippetLayout {
  code: string;
  billableLength: number;
  skipMask: boolean[];
  startIndex: number;
}

/** Everything the editor and the seed script need, from a single traversal. */
export function buildLayout(code: string): SnippetLayout {
  const positions = typablePositions(code);
  const skipMask = new Array<boolean>(code.length).fill(true);
  for (const index of positions) skipMask[index] = false;

  return {
    code,
    billableLength: positions.length,
    skipMask,
    startIndex: initialCursor(code),
  };
}

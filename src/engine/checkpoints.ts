/**
 * Statement-boundary index for JavaScript snippets (AGENTS.md §4.4, §4.12).
 *
 * Executing an arbitrary prefix of JavaScript is meaningless — a partial
 * statement is almost always a syntax error. So each JS snippet ships with the
 * set of offsets at which its prefix is guaranteed to parse, and the sandbox
 * re-executes only when the cursor crosses one.
 *
 * Computed at seed time, never in the per-keystroke hot path.
 */
import { parse, type Options } from "acorn";

/**
 * Snippets execute as the body of `new Function(...)` inside the sandbox
 * (§4.4), so a top-level `return` is legal there. Parsing must model the same
 * context, or the guard would reject code the executor happily runs.
 */
export const SNIPPET_PARSE_OPTIONS: Options = {
  ecmaVersion: 2022,
  sourceType: "script",
  allowReturnOutsideFunction: true,
};

/**
 * Offsets where the prefix `code.slice(0, offset)` is a complete program:
 * the end of every top-level statement. A `}` that closes a nested block is not
 * a checkpoint, because the statement containing it is still open.
 */
export function computeCheckpoints(code: string): number[] {
  const program = parse(code, SNIPPET_PARSE_OPTIONS);
  return program.body.map((statement) => statement.end);
}

/**
 * The largest checkpoint at or before the cursor — the prefix the stage should
 * currently be showing. Zero means nothing is safe to run yet.
 */
export function latestCheckpointAt(checkpoints: number[], cursorIndex: number): number {
  let latest = 0;
  for (const checkpoint of checkpoints) {
    if (checkpoint > cursorIndex) break;
    latest = checkpoint;
  }
  return latest;
}

/** Seed-time authoring check: a snippet that cannot be parsed cannot be played. */
export function validateJavaScript(code: string): string[] {
  try {
    parse(code, SNIPPET_PARSE_OPTIONS);
    return [];
  } catch (error) {
    const { message } = error as Error;
    return [`snippet is not parseable JavaScript: ${message}`];
  }
}

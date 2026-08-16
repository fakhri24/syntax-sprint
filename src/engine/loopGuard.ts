/**
 * Loop instrumentation for sandboxed execution (AGENTS.md §4.4, §4.12).
 *
 * `window.onerror` inside the iframe catches thrown exceptions only. It does
 * not catch a runaway loop, which blocks the frame's event loop entirely and
 * never yields to anything that could report it. This pass converts that hang
 * into an ordinary, catchable exception by giving every loop body an iteration
 * budget.
 *
 * Source is edited surgically with magic-string rather than regenerated, so the
 * output still reads like the snippet the player typed.
 */
import { parse } from "acorn";
import MagicString from "magic-string";
import { SNIPPET_PARSE_OPTIONS } from "./checkpoints";

export const DEFAULT_ITERATION_BUDGET = 100_000;

/** Deliberately unpronounceable: the snippet must not be able to reach it. */
const TICK = "__syntaxSprintTick__";

const LOOP_TYPES = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

interface AcornNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function isNode(value: unknown): value is AcornNode {
  return typeof value === "object" && value !== null && typeof (value as AcornNode).type === "string";
}

/** Minimal ESTree walk — avoids a dependency for what amounts to fifteen lines. */
function walk(node: AcornNode, visit: (node: AcornNode) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) walk(item, visit);
    } else if (isNode(value)) {
      walk(value, visit);
    }
  }
}

/**
 * The counter lives in a closure created fresh on every execution, so budgets
 * reset per run. It is keyed per loop *site*, meaning a loop inside a function
 * called many times accumulates across those calls — the budget is a per-run
 * total for that loop, not a per-entry allowance.
 */
function prologue(budget: number): string {
  return (
    `var ${TICK}=(function(){var c=Object.create(null);` +
    `return function(id){c[id]=(c[id]||0)+1;` +
    `if(c[id]>${budget})throw new Error("Loop guard: exceeded ${budget} iterations");};})();\n`
  );
}

/**
 * Returns `code` with an iteration budget woven into every loop.
 *
 * Throws if `code` does not parse — callers must only instrument prefixes that
 * are known-good, which is exactly what the checkpoint index guarantees.
 */
export function instrumentLoops(code: string, budget: number = DEFAULT_ITERATION_BUDGET): string {
  if (code.trim() === "") return code;

  const program = parse(code, SNIPPET_PARSE_OPTIONS) as unknown as AcornNode;
  const magic = new MagicString(code);
  let loopId = 0;

  walk(program, (node) => {
    if (!LOOP_TYPES.has(node.type)) return;

    const body = node.body;
    if (!isNode(body)) return;
    const guard = `${TICK}(${loopId});`;
    loopId += 1;

    if (body.type === "BlockStatement") {
      // Just inside the opening brace.
      magic.appendLeft(body.start + 1, guard);
    } else {
      // `while (x) foo();` — the body needs braces before it can hold a guard.
      magic.appendLeft(body.start, `{${guard}`);
      magic.appendRight(body.end, "}");
    }
  });

  if (loopId === 0) return code;

  magic.prepend(prologue(budget));
  return magic.toString();
}

/** How many loops the pass would instrument. Useful for authoring diagnostics. */
export function countLoops(code: string): number {
  const program = parse(code, SNIPPET_PARSE_OPTIONS) as unknown as AcornNode;
  let loops = 0;
  walk(program, (node) => {
    if (LOOP_TYPES.has(node.type)) loops += 1;
  });
  return loops;
}

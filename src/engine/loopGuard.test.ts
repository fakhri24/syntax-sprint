import { describe, expect, it } from "vitest";
import { DEFAULT_ITERATION_BUDGET, countLoops, instrumentLoops } from "./loopGuard";
import { validateJavaScript } from "./checkpoints";

/** Runs instrumented code the way the sandbox does: fresh function scope. */
function run(code: string, budget?: number) {
  return new Function(instrumentLoops(code, budget))();
}

describe("countLoops", () => {
  it("counts every loop form", () => {
    const code = `
      for (let i = 0; i < 1; i++) {}
      for (const k in {}) {}
      for (const v of []) {}
      while (false) {}
      do {} while (false);
    `;
    expect(countLoops(code)).toBe(5);
  });

  it("counts nested loops separately", () => {
    expect(countLoops("for(;;){ while(true){} }")).toBe(2);
  });

  it("is zero for loop-free code", () => {
    expect(countLoops('const a = [1,2].map(n => n * 2);')).toBe(0);
  });
});

describe("instrumentLoops", () => {
  it("leaves loop-free code completely untouched", () => {
    const code = 'document.querySelector(".card").textContent = "hi";';
    expect(instrumentLoops(code)).toBe(code);
  });

  it("leaves an empty snippet alone", () => {
    expect(instrumentLoops("")).toBe("");
  });

  it("produces parseable output", () => {
    const code = "for (let i = 0; i < 3; i++) { console.log(i); }";
    expect(validateJavaScript(instrumentLoops(code))).toEqual([]);
  });

  it("preserves the original source text", () => {
    const code = "for (let i = 0; i < 3; i++) { total += i; }";
    // magic-string edits in place, so the snippet stays recognizable.
    expect(instrumentLoops(code)).toContain("total += i;");
  });

  it("throws on unparseable input rather than emitting broken code", () => {
    expect(() => instrumentLoops("for (;;) {")).toThrow();
  });
});

describe("runtime behaviour", () => {
  it("lets a normal loop finish", () => {
    expect(run("let total = 0; for (let i = 0; i < 100; i++) total += i; return total;")).toBe(4950);
  });

  it("converts an infinite for-loop into a throw", () => {
    expect(() => run("for (;;) {}", 1_000)).toThrow(/Loop guard: exceeded 1000 iterations/);
  });

  it("converts an infinite while-loop into a throw", () => {
    expect(() => run("while (true) {}", 500)).toThrow(/Loop guard/);
  });

  it("guards a do-while loop", () => {
    expect(() => run("do {} while (true);", 500)).toThrow(/Loop guard/);
  });

  it("guards a for-of over an endless iterator", () => {
    const code = `
      function* endless() { while (true) yield 1; }
      for (const value of endless()) {}
    `;
    expect(() => run(code, 500)).toThrow(/Loop guard/);
  });

  it("guards a braceless loop body", () => {
    // `while (x) foo();` has no block to insert into — the pass adds one.
    expect(() => run("let i = 0; while (true) i++;", 400)).toThrow(/Loop guard/);
  });

  it("guards a braceless body without changing its semantics", () => {
    expect(run("let n = 0; for (let i = 0; i < 5; i++) n += i; return n;")).toBe(10);
  });

  it("budgets each loop site independently", () => {
    // Two sequential loops of 600 each must both survive a 1000 budget.
    const code = `
      let a = 0, b = 0;
      for (let i = 0; i < 600; i++) a++;
      for (let i = 0; i < 600; i++) b++;
      return a + b;
    `;
    expect(run(code, 1_000)).toBe(1200);
  });

  it("catches the inner loop of a nested pair", () => {
    expect(() => run("for (let i = 0; i < 3; i++) { while (true) {} }", 1_000)).toThrow(/Loop guard/);
  });

  it("resets the budget on each execution", () => {
    const code = "let n = 0; for (let i = 0; i < 900; i++) n++; return n;";
    const instrumented = instrumentLoops(code, 1_000);
    // Each EXEC builds a new function, so a second run starts from zero.
    expect(new Function(instrumented)()).toBe(900);
    expect(new Function(instrumented)()).toBe(900);
  });

  it("defaults to a budget high enough for real snippets", () => {
    expect(DEFAULT_ITERATION_BUDGET).toBeGreaterThanOrEqual(100_000);
    expect(run("let n = 0; for (let i = 0; i < 50000; i++) n++; return n;")).toBe(50_000);
  });

  it("throws an ordinary Error, so the sandbox's existing catch handles it", () => {
    try {
      run("while (true) {}", 100);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/Loop guard/);
    }
  });
});

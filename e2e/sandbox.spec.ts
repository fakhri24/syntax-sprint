import { test, expect, type Page } from "@playwright/test";

/**
 * Real-browser coverage for AGENTS.md §4.4. The EXEC/ACK protocol, the opaque
 * origin, and checkpoint execution all need a live frame — jsdom does not run
 * scripts inside an iframe srcdoc.
 */

const PROBE = "/dev/sandbox-probe";

async function setCursor(page: Page, index: number) {
  // Fail loudly rather than no-op: an unhydrated probe would let a cursor-0
  // assertion pass against an unchanged 0.
  await page.evaluate((i) => {
    if (!window.__setSandboxCursor) throw new Error("sandbox probe is not hydrated");
    window.__setSandboxCursor(i);
  }, index);
  await expect(page.getByTestId("cursor")).toHaveText(String(index));
}

/** Reads inside the sandboxed frame, which the parent cannot script into. */
const stage = (page: Page) => page.frameLocator('[data-testid="iframe-sandbox"]');

test.describe("iframe sandbox", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROBE);
    await expect(page.getByTestId("status")).toHaveText("ready");
  });

  test("reports ready once the bootstrap loads", async ({ page }) => {
    await expect(page.getByTestId("errors")).toBeEmpty();
    await expect(stage(page).locator(".card")).toHaveText("idle");
  });

  test("does not execute before the first checkpoint", async ({ page }) => {
    const checkpoints = (await page.getByTestId("checkpoints").textContent())!.split(",").map(Number);

    await setCursor(page, checkpoints[0] - 5);
    await expect(stage(page).locator(".card")).toHaveText("idle");
    await expect(page.getByTestId("errors")).toBeEmpty();
  });

  test("executes when the cursor crosses a checkpoint", async ({ page }) => {
    const checkpoints = (await page.getByTestId("checkpoints").textContent())!.split(",").map(Number);

    // First statement only declares; the second is what changes the text.
    await setCursor(page, checkpoints[1]);
    await expect(stage(page).locator(".card")).toHaveText("activated");
  });

  test("resets the document on each execution rather than accumulating state", async ({ page }) => {
    const checkpoints = (await page.getByTestId("checkpoints").textContent())!.split(",").map(Number);

    await setCursor(page, checkpoints[2]);
    await expect(stage(page).locator(".card")).toHaveAttribute("data-done", "yes");

    // Going back to an earlier checkpoint must undo the later statement, because
    // each run starts from the curated markup again.
    await setCursor(page, checkpoints[1]);
    await expect(stage(page).locator(".card")).toHaveText("activated");
    await expect(stage(page).locator(".card")).not.toHaveAttribute("data-done", "yes");
  });

  test("re-running a prefix that declares a const does not throw", async ({ page }) => {
    const checkpoints = (await page.getByTestId("checkpoints").textContent())!.split(",").map(Number);

    for (const checkpoint of [...checkpoints, ...checkpoints]) {
      await setCursor(page, checkpoint);
    }

    // `new Function` gives each run its own scope; global eval would have failed
    // here with "Identifier 'card' has already been declared".
    await expect(page.getByTestId("errors")).toBeEmpty();
  });

  test("reports a runtime error without breaking the host page", async ({ page }) => {
    await page.evaluate(() => window.__setSandboxCode?.("missingFunction();"));
    await setCursor(page, "missingFunction();".length);

    await expect(page.getByTestId("errors")).toContainText("missingFunction is not defined");
    await expect(page.getByTestId("status")).toHaveText("error");
    // The probe itself is still alive and responsive.
    await setCursor(page, 0);
  });

  test("cannot reach the parent document", async ({ page }) => {
    await page.evaluate(() =>
      window.__setSandboxCode?.(
        "try { parent.document.title = 'pwned'; } catch (e) { document.querySelector('.card').textContent = 'blocked'; }",
      ),
    );
    const length = Number(await page.getByTestId("code-length").textContent());
    await setCursor(page, length);

    await expect(stage(page).locator(".card")).toHaveText("blocked");
    await expect(page).toHaveTitle(/^(?!pwned).*$/);
  });
});

test.describe("runaway loop containment", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROBE);
    await expect(page.getByTestId("probe")).toHaveAttribute("data-ready", "true");
    await expect(page.getByTestId("status")).toHaveText("ready");
  });

  test("the loop guard turns an infinite loop into a reported error", async ({ page }) => {
    await page.evaluate(() =>
      window.__setSandboxCode?.(
        'let n = 0; while (true) { n++; }\ndocument.querySelector(".card").textContent = "done";',
      ),
    );
    const length = Number(await page.getByTestId("code-length").textContent());
    await setCursor(page, length);

    await expect(page.getByTestId("errors")).toContainText("Loop guard");
    // An ordinary error, not a watchdog reset — the guard caught it in-frame.
    await expect(page.getByTestId("errors")).not.toContainText("Stage reset");
    await expect(page.getByTestId("status")).toHaveText("error");
  });

  test("guards every loop form", async ({ page }) => {
    const snippets = [
      "for (;;) {}",
      "while (true) {}",
      "do {} while (true);",
      "let i = 0; while (true) i++;",
      "function* e() { while (true) yield 1; } for (const v of e()) {}",
    ];

    for (const snippet of snippets) {
      await page.evaluate((code) => window.__setSandboxCode?.(code), snippet);
      const length = Number(await page.getByTestId("code-length").textContent());
      await setCursor(page, length);
      await expect(page.getByTestId("errors")).toContainText("Loop guard");
    }
  });

  test("a big but finite loop still completes", async ({ page }) => {
    await page.evaluate(() =>
      window.__setSandboxCode?.(
        'let n = 0; for (let i = 0; i < 50000; i++) n++;\ndocument.querySelector(".card").textContent = String(n);',
      ),
    );
    const length = Number(await page.getByTestId("code-length").textContent());
    await setCursor(page, length);

    await expect(stage(page).locator(".card")).toHaveText("50000");
    await expect(page.getByTestId("errors")).toBeEmpty();
  });

  test("infinite recursion is not a loop, but still self-terminates", async ({ page }) => {
    // Not instrumented — the stack overflows into a RangeError, which the
    // sandbox's existing try/catch reports like any other throw (§4.4).
    await page.evaluate(() => window.__setSandboxCode?.("function f() { return f(); }\nf();"));
    const length = Number(await page.getByTestId("code-length").textContent());
    await setCursor(page, length);

    await expect(page.getByTestId("errors")).toContainText(/call stack|Maximum/i);
    await expect(page.getByTestId("status")).toHaveText("error");
  });

  /**
   * There is deliberately no test that disables the guard and spins the frame.
   * A srcdoc iframe runs on the parent's main thread, so such a test would
   * freeze the page it is asserting against — measured directly: the parent's
   * own interval stopped ticking and page.evaluate never returned. That is
   * precisely why instrumentation has no opt-out (AGENTS.md §4.4).
   */
});

import { test, expect, type Page } from "@playwright/test";

/**
 * The arena end to end (PLAN 4.3).
 *
 * Every part of this has unit coverage; what is unproven until here is that they
 * compose — that a real keypress moves the real cursor, drives the real stage,
 * and lands on a real summary.
 *
 * These run signed out, so they exercise practice mode. Scoring needs a Google
 * sign-in, which Playwright cannot perform against real Firebase.
 */

const CSS_LEVEL = "/play/rocket-launch";
const JS_LEVEL = "/play/interactive-card";

async function openArena(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId("arena")).toBeVisible();
  // The arena refuses to start until it knows whether the run will score (§4.6).
  await expect(page.getByTestId("scoring-notice")).toBeVisible();
  await page.getByTestId("input-target").focus();
}

/** Reads the snippet the way the player sees it, skipping auto-skipped indentation. */
async function typableSequence(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const spans = [...document.querySelectorAll<HTMLElement>("[data-index]")];
    return spans.filter((s) => s.dataset.state !== "skipped").map((s) => s.textContent ?? "");
  });
}

async function typeRun(page: Page, keys: string[]) {
  for (const key of keys) {
    await page.keyboard.press(key === "\n" ? "Enter" : key === " " ? "Space" : key);
  }
}

test.describe("arena", () => {
  test("types a CSS level to completion and shows a summary", async ({ page }) => {
    await openArena(page, CSS_LEVEL);
    await typeRun(page, await typableSequence(page));

    await expect(page.getByTestId("arena")).toHaveAttribute("data-phase", "FINISHED");
    const summary = page.getByTestId("completion");
    await expect(summary).toBeVisible();
    await expect(page.getByTestId("summary-accuracy")).toHaveText("100%");
  });

  test("drives the live stage as the player types", async ({ page }) => {
    await openArena(page, CSS_LEVEL);

    // Playwright's CSS engine pierces open shadow roots, and toHaveCSS retries —
    // which matters because the stage animates: reading opacity once, straight
    // after the last keystroke, catches the transition mid-flight.
    const rocket = page.locator('[data-testid="shadow-stage"] .rocket');

    await expect(rocket).toHaveCSS("opacity", "0.2");
    await typeRun(page, await typableSequence(page));
    // The rule only applies once the closing brace lands (§4.4).
    await expect(rocket).toHaveCSS("opacity", "1");
  });

  test("hard-locks on a typo and only Backspace releases it", async ({ page }) => {
    await openArena(page, CSS_LEVEL);

    await page.keyboard.press("x");
    const errored = page.locator('[data-index="0"]');
    await expect(errored).toHaveAttribute("data-state", "error");

    // Every other key is refused while locked (§4.3).
    await page.keyboard.press("a");
    await page.keyboard.press("Enter");
    await expect(errored).toHaveAttribute("data-state", "error");

    await page.keyboard.press("Backspace");
    await expect(errored).toHaveAttribute("data-state", "pending");

    await page.keyboard.press(".");
    await expect(errored).toHaveAttribute("data-state", "typed");
  });

  test("never asks the player to type indentation", async ({ page }) => {
    await openArena(page, CSS_LEVEL);

    const skipped = await page.evaluate(
      () => document.querySelectorAll('[data-state="skipped"]').length,
    );
    // The CSS level is indented, so some characters must be auto-skipped (§4.2).
    expect(skipped).toBeGreaterThan(0);

    await typeRun(page, await typableSequence(page));
    await expect(page.getByTestId("arena")).toHaveAttribute("data-phase", "FINISHED");
  });

  test("tells a signed-out player up front that the run will not count", async ({ page }) => {
    await openArena(page, CSS_LEVEL);

    const notice = page.getByTestId("scoring-notice");
    await expect(notice).toHaveAttribute("data-scoring", "no");
    await expect(notice).toContainText(/before you start/i);

    await typeRun(page, await typableSequence(page));
    // And says the same afterwards, rather than springing it as a surprise.
    await expect(page.getByTestId("submit-practice")).toBeVisible();
  });

  test("restarts cleanly, carrying nothing over", async ({ page }) => {
    await openArena(page, CSS_LEVEL);
    await page.keyboard.press("x");
    await page.keyboard.press("Backspace");
    await typeRun(page, await typableSequence(page));

    await page.getByTestId("restart").click();

    await expect(page.getByTestId("arena")).toHaveAttribute("data-phase", "IDLE");
    await expect(page.getByTestId("completion")).toBeHidden();
    await expect(page.locator('[data-index="0"]')).toHaveAttribute("data-state", "pending");
  });

  test("runs the JavaScript level in its sandbox at checkpoints", async ({ page }) => {
    await openArena(page, JS_LEVEL);
    const stage = page.frameLocator('[data-testid="iframe-sandbox"]');

    await expect(stage.locator(".card")).toContainText("closed");
    await typeRun(page, await typableSequence(page));

    // The final statement clicks the card, so the listener must have attached.
    await expect(stage.locator(".label")).toHaveText("open");
  });

  test("keeps the summary accurate when the player makes mistakes", async ({ page }) => {
    await openArena(page, CSS_LEVEL);

    await page.keyboard.press("q");
    await page.keyboard.press("Backspace");
    await typeRun(page, await typableSequence(page));

    await expect(page.getByTestId("completion")).toBeVisible();
    const accuracy = await page.getByTestId("summary-accuracy").textContent();
    // One error attempt must cost accuracy, even though the final text is perfect.
    expect(Number(accuracy!.replace("%", ""))).toBeLessThan(100);
  });
});

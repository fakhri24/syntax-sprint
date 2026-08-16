import { test, expect, type Page } from "@playwright/test";

/**
 * Real-engine coverage for AGENTS.md §4.4. The central claim — that a half-typed
 * declaration degrades silently instead of crashing — depends on the browser's
 * own CSS/HTML error recovery, which jsdom does not reproduce.
 */

const PROBE = "/dev/stage-probe";

async function setCursor(page: Page, index: number) {
  // Fail loudly if the probe is not hydrated: a missing setter would otherwise
  // no-op, and asserting cursor 0 against an unchanged 0 passes for free.
  await page.evaluate((i) => {
    if (!window.__setStageCursor) throw new Error("stage probe is not hydrated");
    window.__setStageCursor(i);
  }, index);
  await expect(page.getByTestId("cursor")).toHaveText(String(index));
}

const rocketOpacity = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector('[data-testid="shadow-stage"]')!;
    const rocket = host.shadowRoot!.querySelector(".rocket")!;
    return getComputedStyle(rocket).opacity;
  });

test.describe("shadow DOM stage", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROBE);
    await expect(page.getByTestId("probe")).toHaveAttribute("data-ready", "true");
  });

  test("steps through every prefix of a CSS snippet without a single error", async ({ page }) => {
    const length = Number(await page.getByTestId("code-length").textContent());

    for (let cursor = 0; cursor <= length; cursor += 1) {
      await setCursor(page, cursor);
    }

    await expect(page.getByTestId("errors")).toBeEmpty();
  });

  test("applies a CSS rule only once it is syntactically complete", async ({ page }) => {
    // Mid-declaration: the browser drops the incomplete rule, so nothing applies.
    await setCursor(page, ".rocket { transform: transl".length);
    expect(await rocketOpacity(page)).toBe("1");

    // The closing brace completes the block and the declarations take effect.
    await setCursor(page, Number(await page.getByTestId("code-length").textContent()));
    expect(await rocketOpacity(page)).toBe("0.5");
  });

  test("keeps typed styles from leaking into the host page", async ({ page }) => {
    await setCursor(page, Number(await page.getByTestId("code-length").textContent()));

    // A .rocket in the host document must be untouched by the stage's stylesheet.
    const hostOpacity = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "rocket";
      document.body.appendChild(probe);
      const opacity = getComputedStyle(probe).opacity;
      probe.remove();
      return opacity;
    });

    expect(hostOpacity).toBe("1");
  });

  test("steps through every prefix of an SVG snippet without a single error", async ({ page }) => {
    await page.getByTestId("lang-svg").click();
    const length = Number(await page.getByTestId("code-length").textContent());

    for (let cursor = 0; cursor <= length; cursor += 1) {
      await setCursor(page, cursor);
    }

    await expect(page.getByTestId("errors")).toBeEmpty();
  });

  test("renders the SVG path once the tag closes", async ({ page }) => {
    await page.getByTestId("lang-svg").click();
    await setCursor(page, Number(await page.getByTestId("code-length").textContent()));

    const fill = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="shadow-stage"]')!;
      const path = host.shadowRoot!.querySelector("svg path");
      return path ? getComputedStyle(path).fill : null;
    });

    expect(fill).toBe("rgb(255, 0, 0)");
  });
});

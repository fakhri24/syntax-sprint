import { test, expect, type Page } from "@playwright/test";

/**
 * Real-browser coverage for AGENTS.md §4.1. Everything here is unreachable from
 * jsdom: physical keyboard layouts, dead keys, IME composition, and the actual
 * paste pipeline.
 */

const PROBE = "/dev/input-probe";

async function openProbe(page: Page) {
  await page.goto(PROBE);
  // Typing before the controller attaches would drop the keystrokes entirely.
  await expect(page.getByTestId("probe")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("input-target").focus();
}

const log = (page: Page) => page.getByTestId("log");
const typed = (page: Page) => page.getByTestId("typed");

test.describe("input normalization", () => {
  test("types a code snippet character by character", async ({ page }) => {
    await openProbe(page);
    const snippet = "const x = { a: [1] };";

    for (const char of snippet) {
      await page.keyboard.press(char === " " ? "Space" : char);
    }

    await expect(typed(page)).toHaveText(snippet);
  });

  test("delivers braces and brackets as single characters", async ({ page }) => {
    await openProbe(page);
    for (const char of ["{", "}", "[", "]", "\\", "|"]) {
      await page.keyboard.type(char);
    }
    await expect(typed(page)).toHaveText("{}[]\\|");
  });

  test("Enter and Backspace emit exactly once each, not twice", async ({ page }) => {
    await openProbe(page);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Backspace");

    // The beforeinput twins (insertLineBreak / deleteContentBackward) must be
    // ignored, so nothing beyond these two lines may appear.
    await expect(log(page)).toHaveText("enter\nbackspace");
  });

  test("Tab does not move focus and produces no input", async ({ page }) => {
    await openProbe(page);
    await page.keyboard.press("Tab");

    await expect(page.getByTestId("input-target")).toBeFocused();
    await expect(log(page)).toHaveText("ignored:control-key");
    await expect(typed(page)).toBeEmpty();
  });

  test("modifier keys alone never produce input", async ({ page }) => {
    await openProbe(page);
    for (const key of ["Shift", "Control", "Alt", "Meta", "CapsLock"]) {
      await page.keyboard.press(key);
    }
    await expect(typed(page)).toBeEmpty();
    await expect(log(page)).not.toContainText("char:");
  });

  test("pasting a whole snippet is rejected", async ({ page, context, browserName }) => {
    test.skip(browserName === "webkit", "clipboard permissions are not grantable in WebKit");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openProbe(page);

    await page.evaluate(() => navigator.clipboard.writeText("const cheat = true;"));
    await page.keyboard.press("ControlOrMeta+V");

    await expect(typed(page)).toBeEmpty();
    await expect(log(page)).toContainText("ignored:paste");
  });

  test("the hidden textarea never accumulates text", async ({ page }) => {
    await openProbe(page);
    await page.keyboard.type("abc");
    await expect(page.getByTestId("input-target")).toHaveValue("");
  });

  test("a dead-key sequence commits one character", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP composition control is Chromium-only");
    await openProbe(page);

    // Option+e then e on a US-International layout produces "é" — one keystroke,
    // not two, and none of the intermediate states may be counted.
    const session = await page.context().newCDPSession(page);
    await session.send("Input.imeSetComposition", {
      text: "´",
      selectionStart: 0,
      selectionEnd: 1,
    });
    await session.send("Input.insertText", { text: "é" });
    await session.detach();

    await expect(typed(page)).toHaveText("é");
    await expect(log(page)).not.toContainText("char:´");
  });

  test("an IME commit is split into one keystroke per code point", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP composition control is Chromium-only");
    await openProbe(page);

    const session = await page.context().newCDPSession(page);
    // Intermediate composition states must produce nothing.
    await session.send("Input.imeSetComposition", { text: "にほ", selectionStart: 0, selectionEnd: 2 });
    await expect(typed(page)).toBeEmpty();

    await session.send("Input.insertText", { text: "日本" });
    await session.detach();

    await expect(typed(page)).toHaveText("日本");
    // Two code points committed, and the "にほ" composition states leaked nothing.
    await expect(page.getByTestId("char-count")).toHaveText("2");
    await expect(log(page)).not.toContainText("char:に");
  });
});

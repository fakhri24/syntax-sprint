import { describe, expect, it } from "vitest";
import {
  attachInputController,
  evaluateBeforeInput,
  evaluateKeyDown,
  splitCommittedText,
  type IgnoreReason,
} from "./input";
import type { GameInput } from "@/types/game";

const beforeInput = (inputType: string, data: string | null = null, isComposing = false) =>
  evaluateBeforeInput({ inputType, data, isComposing });

const keyDown = (key: string, mods: { ctrlKey?: boolean; metaKey?: boolean } = {}) =>
  evaluateKeyDown({ key, ctrlKey: false, metaKey: false, ...mods });

describe("evaluateBeforeInput", () => {
  it("accepts a single inserted character", () => {
    expect(beforeInput("insertText", "a")).toEqual({ kind: "char", char: "a" });
  });

  it("accepts the punctuation that moves around on non-US layouts", () => {
    for (const char of ["{", "}", "[", "]", "\\", "|", "@", "#", "~", "`"]) {
      expect(beforeInput("insertText", char)).toEqual({ kind: "char", char });
    }
  });

  it("rejects multi-character insertions", () => {
    expect(beforeInput("insertText", "const")).toEqual({ kind: "ignored", reason: "multi-char" });
  });

  it("rejects paste and drop", () => {
    expect(beforeInput("insertFromPaste", "x")).toEqual({ kind: "ignored", reason: "paste" });
    expect(beforeInput("insertFromPasteAsQuotation", "x")).toEqual({ kind: "ignored", reason: "paste" });
    expect(beforeInput("insertFromDrop", "x")).toEqual({ kind: "ignored", reason: "drop" });
  });

  it("ignores everything while composing, whatever the inputType", () => {
    expect(beforeInput("insertText", "a", true)).toEqual({ kind: "ignored", reason: "composing" });
    expect(beforeInput("insertCompositionText", "n")).toEqual({ kind: "ignored", reason: "composing" });
  });

  it("defers Enter and Backspace to the keydown path so they cannot double-count", () => {
    for (const type of ["insertLineBreak", "insertParagraph", "deleteContentBackward", "deleteWordBackward"]) {
      expect(beforeInput(type, null)).toEqual({ kind: "ignored", reason: "handled-elsewhere" });
    }
    expect(beforeInput("insertText", "\n")).toEqual({ kind: "ignored", reason: "handled-elsewhere" });
  });

  it("ignores unknown input types and empty data", () => {
    expect(beforeInput("formatBold")).toEqual({ kind: "ignored", reason: "unsupported" });
    expect(beforeInput("insertText", "")).toEqual({ kind: "ignored", reason: "unsupported" });
  });
});

describe("evaluateKeyDown", () => {
  it("maps the two control keys the game owns", () => {
    expect(keyDown("Backspace")).toEqual({ kind: "backspace" });
    expect(keyDown("Enter")).toEqual({ kind: "enter" });
  });

  it("never lets a modifier key produce input (§4.1)", () => {
    for (const key of ["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"]) {
      expect(keyDown(key)).toEqual({ kind: "ignored", reason: "control-key" });
    }
  });

  it("ignores printable keys — characters come from beforeinput", () => {
    expect(keyDown("a")).toEqual({ kind: "ignored", reason: "control-key" });
    expect(keyDown("{")).toEqual({ kind: "ignored", reason: "control-key" });
  });

  it("ignores Tab and Escape", () => {
    expect(keyDown("Tab")).toEqual({ kind: "ignored", reason: "control-key" });
    expect(keyDown("Escape")).toEqual({ kind: "ignored", reason: "control-key" });
  });

  it("passes shortcuts through untouched, including Ctrl+Backspace", () => {
    expect(keyDown("r", { ctrlKey: true })).toEqual({ kind: "ignored", reason: "shortcut" });
    expect(keyDown("Backspace", { ctrlKey: true })).toEqual({ kind: "ignored", reason: "shortcut" });
    expect(keyDown("Enter", { metaKey: true })).toEqual({ kind: "ignored", reason: "shortcut" });
  });
});

describe("splitCommittedText", () => {
  it("keeps a composed glyph as one keystroke", () => {
    expect(splitCommittedText("é")).toEqual(["é"]);
  });

  it("splits a multi-glyph IME commit into individual keystrokes", () => {
    expect(splitCommittedText("こんにちは")).toHaveLength(5);
  });

  it("does not split a surrogate pair", () => {
    expect(splitCommittedText("🚀")).toEqual(["🚀"]);
  });
});

describe("attachInputController", () => {
  function setup() {
    const target = document.createElement("textarea");
    document.body.appendChild(target);
    const inputs: GameInput[] = [];
    const rejections: IgnoreReason[] = [];
    const detach = attachInputController({
      target,
      onInput: (i) => inputs.push(i),
      onIgnored: (r) => rejections.push(r),
    });
    return { target, inputs, rejections, detach };
  }

  const fireBeforeInput = (target: HTMLElement, init: Partial<InputEventInit> & { inputType: string }) => {
    const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  it("emits characters and prevents the textarea from accumulating text", () => {
    const { target, inputs, detach } = setup();
    const event = fireBeforeInput(target, { inputType: "insertText", data: "x" });

    expect(inputs).toEqual([{ kind: "char", char: "x" }]);
    expect(event.defaultPrevented).toBe(true);
    expect(target.value).toBe("");
    detach();
  });

  it("blocks paste without emitting an input", () => {
    const { target, inputs, rejections, detach } = setup();
    const event = fireBeforeInput(target, { inputType: "insertFromPaste", data: "const x = 1;" });

    expect(inputs).toEqual([]);
    expect(rejections).toEqual(["paste"]);
    expect(event.defaultPrevented).toBe(true);
    detach();
  });

  it("lets the IME write during composition, then commits one char per code point", () => {
    const { target, inputs, detach } = setup();

    const composing = fireBeforeInput(target, { inputType: "insertCompositionText", data: "n", isComposing: true });
    // Must NOT be prevented, or the IME breaks.
    expect(composing.defaultPrevented).toBe(false);
    expect(inputs).toEqual([]);

    target.value = "ñ"; // what the IME left behind
    target.dispatchEvent(new CompositionEvent("compositionend", { data: "ñ", bubbles: true }));

    expect(inputs).toEqual([{ kind: "char", char: "ñ" }]);
    expect(target.value).toBe("");
    detach();
  });

  it("swallows Tab so focus cannot escape mid-run", () => {
    const { target, inputs, rejections, detach } = setup();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    target.dispatchEvent(event);

    expect(inputs).toEqual([]);
    expect(rejections).toEqual(["control-key"]);
    expect(event.defaultPrevented).toBe(true);
    detach();
  });

  it("leaves shortcuts unprevented so refresh still works", () => {
    const { target, detach } = setup();
    const event = new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true });
    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    detach();
  });

  it("emits Enter and Backspace from keydown", () => {
    const { target, inputs, detach } = setup();
    for (const key of ["Enter", "Backspace"]) {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
    expect(inputs).toEqual([{ kind: "enter" }, { kind: "backspace" }]);
    detach();
  });

  it("stops emitting once detached", () => {
    const { target, inputs, detach } = setup();
    detach();
    fireBeforeInput(target, { inputType: "insertText", data: "x" });
    expect(inputs).toEqual([]);
  });

  it("does not double-count a newline delivered on both paths", () => {
    const { target, inputs, detach } = setup();
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    fireBeforeInput(target, { inputType: "insertLineBreak", data: null });

    expect(inputs).toEqual([{ kind: "enter" }]);
    detach();
  });

  it("reports rejections so the engine can count blockedKeystrokes", () => {
    const { target, rejections, detach } = setup();

    fireBeforeInput(target, { inputType: "insertText", data: "const" });
    fireBeforeInput(target, { inputType: "formatBold", data: null });

    expect(rejections).toEqual(["multi-char", "unsupported"]);
    detach();
  });
});

/**
 * Input normalization layer (AGENTS.md §4.1).
 *
 * Characters are read from `beforeinput`, never from `keydown`. A synchronous
 * keydown handler cannot represent dead keys, AltGr combinations, or IME
 * composition — and `{`, `[`, `\`, `|` are exactly the characters that move
 * around on non-US layouts. Only control keys come from `keydown`.
 *
 * The two `evaluate*` functions are pure so the whole decision table is unit
 * testable; `attachInputController` is the thin DOM wiring around them.
 */
import type { GameInput } from "@/types/game";

export type IgnoreReason =
  /** Mid-IME composition. The committed text arrives at compositionend. */
  | "composing"
  | "paste"
  | "drop"
  /** More than one character in a single insertText — autofill, or a paste we missed. */
  | "multi-char"
  /** Tab, Escape, arrows, modifiers, and printable keys (those come via beforeinput). */
  | "control-key"
  /** Ctrl/Meta held: a browser or app shortcut, not gameplay. */
  | "shortcut"
  /** Enter and Backspace are owned by the keydown path; ignore their beforeinput twins. */
  | "handled-elsewhere"
  | "unsupported";

export type InputEvaluation = GameInput | { kind: "ignored"; reason: IgnoreReason };

export interface BeforeInputInit {
  inputType: string;
  data: string | null;
  isComposing: boolean;
}

export interface KeyDownInit {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}

const ignored = (reason: IgnoreReason): InputEvaluation => ({ kind: "ignored", reason });

/** Splits committed text into code points, so an emoji or accented glyph stays one keystroke. */
export function splitCommittedText(text: string): string[] {
  return Array.from(text);
}

export function evaluateBeforeInput({ inputType, data, isComposing }: BeforeInputInit): InputEvaluation {
  // Never interpret anything mid-composition: the intermediate states of an IME
  // (or a dead-key sequence) are not characters the player typed.
  if (isComposing || inputType === "insertCompositionText") return ignored("composing");

  switch (inputType) {
    case "insertFromPaste":
    case "insertFromPasteAsQuotation":
      return ignored("paste");
    case "insertFromDrop":
      return ignored("drop");
    // Enter and Backspace are handled in keydown; ignoring their beforeinput
    // twins is what stops every newline from being counted twice.
    case "insertLineBreak":
    case "insertParagraph":
    case "deleteContentBackward":
    case "deleteContentForward":
    case "deleteWordBackward":
    case "deleteWordForward":
      return ignored("handled-elsewhere");
    case "insertText": {
      if (!data) return ignored("unsupported");
      const points = splitCommittedText(data);
      if (points.length > 1) return ignored("multi-char");
      // Some browsers deliver Enter as insertText("\n"); keydown already owns it.
      if (data === "\n" || data === "\r") return ignored("handled-elsewhere");
      return { kind: "char", char: points[0] };
    }
    default:
      return ignored("unsupported");
  }
}

export function evaluateKeyDown({ key, ctrlKey, metaKey }: KeyDownInit): InputEvaluation {
  // Let browser/app shortcuts through untouched. AltGr reports ctrlKey+altKey on
  // Windows, but AltGr only ever produces characters, which arrive via beforeinput.
  if (ctrlKey || metaKey) return ignored("shortcut");
  if (key === "Backspace") return { kind: "backspace" };
  if (key === "Enter") return { kind: "enter" };
  return ignored("control-key");
}

export interface InputControllerOptions {
  /** A hidden, focused textarea. It stays empty: every mutation is prevented or cleared. */
  target: HTMLTextAreaElement;
  onInput: (input: GameInput) => void;
  /** Fires for every rejected input, so the engine can count blockedKeystrokes. */
  onIgnored?: (reason: IgnoreReason) => void;
}

/** Wires the decision table to a DOM element. Returns a detach function. */
export function attachInputController({ target, onInput, onIgnored }: InputControllerOptions): () => void {
  const reject = (reason: IgnoreReason) => onIgnored?.(reason);

  const handleBeforeInput = (event: Event) => {
    const e = event as InputEvent;
    const evaluation = evaluateBeforeInput({
      inputType: e.inputType,
      data: e.data,
      isComposing: e.isComposing,
    });

    if (evaluation.kind !== "ignored") {
      event.preventDefault();
      onInput(evaluation);
      return;
    }

    // Preventing default mid-composition breaks the IME, so let it write into the
    // textarea and clear it at compositionend instead. Everything else is blocked
    // so the textarea can never accumulate text.
    if (evaluation.reason !== "composing") event.preventDefault();
    reject(evaluation.reason);
  };

  const handleCompositionEnd = (event: Event) => {
    const e = event as CompositionEvent;
    for (const char of splitCommittedText(e.data ?? "")) {
      onInput({ kind: "char", char });
    }
    // The composition wrote into the textarea; discard it.
    target.value = "";
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const evaluation = evaluateKeyDown({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });

    if (evaluation.kind !== "ignored") {
      event.preventDefault();
      onInput(evaluation);
      return;
    }

    // Tab must be swallowed or focus escapes the hidden textarea mid-run.
    // Everything else is left alone so shortcuts and refresh still work.
    if (event.key === "Tab") event.preventDefault();
    reject(evaluation.reason);
  };

  // beforeinput does not fire for drops in every browser, so guard both directly.
  const handlePaste = (event: Event) => {
    event.preventDefault();
    reject("paste");
  };
  const handleDrop = (event: Event) => {
    event.preventDefault();
    reject("drop");
  };

  target.addEventListener("beforeinput", handleBeforeInput);
  target.addEventListener("compositionend", handleCompositionEnd);
  target.addEventListener("keydown", handleKeyDown);
  target.addEventListener("paste", handlePaste);
  target.addEventListener("drop", handleDrop);

  return () => {
    target.removeEventListener("beforeinput", handleBeforeInput);
    target.removeEventListener("compositionend", handleCompositionEnd);
    target.removeEventListener("keydown", handleKeyDown);
    target.removeEventListener("paste", handlePaste);
    target.removeEventListener("drop", handleDrop);
  };
}

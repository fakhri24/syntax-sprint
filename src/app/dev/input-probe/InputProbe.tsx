"use client";

import { useEffect, useRef, useState } from "react";
import { attachInputController, type IgnoreReason } from "@/engine/input";
import type { GameInput } from "@/types/game";

type Entry = { accepted: true; input: GameInput } | { accepted: false; reason: IgnoreReason };

function describe(entry: Entry): string {
  if (!entry.accepted) return `ignored:${entry.reason}`;
  return entry.input.kind === "char" ? `char:${entry.input.char}` : entry.input.kind;
}

export default function InputProbe() {
  const targetRef = useRef<HTMLTextAreaElement>(null);
  const readyRef = useRef<HTMLPreElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    target.focus();
    // Specs must not type before the controller is attached, or the keystrokes
    // vanish and the assertion fails for a reason unrelated to the code.
    readyRef.current?.setAttribute("data-ready", "true");
    return attachInputController({
      target,
      onInput: (input) => setEntries((prev) => [...prev, { accepted: true, input }]),
      onIgnored: (reason) => setEntries((prev) => [...prev, { accepted: false, reason }]),
    });
  }, []);

  // The specs read these two nodes. `data-log` is the full event trace;
  // `data-typed` is just the characters, so a spec can assert on typed text directly.
  const typed = entries
    .filter((e): e is Extract<Entry, { accepted: true }> => e.accepted && e.input.kind === "char")
    .map((e) => (e.input as { kind: "char"; char: string }).char)
    .join("");

  return (
    <main style={{ fontFamily: "monospace", padding: 24 }}>
      <h1>Input probe</h1>
      <textarea
        ref={targetRef}
        data-testid="input-target"
        aria-label="input target"
        style={{ width: 320, height: 60 }}
      />
      <button type="button" data-testid="reset" onClick={() => setEntries([])}>
        reset
      </button>
      <pre ref={readyRef} data-testid="probe" data-ready="false" />
      <pre data-testid="typed">{typed}</pre>
      <pre data-testid="log">{entries.map(describe).join("\n")}</pre>
      {/* Accepted characters only — distinct from the total event count, which
          includes every ignored input. */}
      <pre data-testid="char-count">{Array.from(typed).length}</pre>
      <pre data-testid="event-count">{entries.length}</pre>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import IframeSandbox, { type SandboxStatus } from "@/components/stage/IframeSandbox";
import { computeCheckpoints } from "@/engine/checkpoints";
import { normalizeSnippet } from "@/engine/layout";

export const JS_SNIPPET = normalizeSnippet(`const card = document.querySelector(".card");
card.textContent = "activated";
card.dataset.done = "yes";`);

declare global {
  interface Window {
    __setSandboxCursor?: (index: number) => void;
    __setSandboxCode?: (code: string) => void;
  }
}

export default function SandboxProbe() {
  const [cursorIndex, setCursorIndex] = useState(0);
  const [code, setCode] = useState(JS_SNIPPET);
  const [status, setStatus] = useState<SandboxStatus>("loading");
  const [errors, setErrors] = useState<string[]>([]);

  const readyRef = useRef<HTMLPreElement>(null);

  const checkpoints = useMemo(() => {
    try {
      return computeCheckpoints(code);
    } catch {
      return [code.length];
    }
  }, [code]);

  useEffect(() => {
    window.__setSandboxCursor = setCursorIndex;
    window.__setSandboxCode = (next) => {
      setErrors([]);
      setCursorIndex(0);
      setCode(next);
    };
    readyRef.current?.setAttribute("data-ready", "true");
    return () => {
      delete window.__setSandboxCursor;
      delete window.__setSandboxCode;
    };
  }, []);

  return (
    <main style={{ fontFamily: "monospace", padding: 24 }}>
      <h1>Sandbox probe</h1>
      <IframeSandbox
        initialStageHTML='<div class="card">idle</div>'
        code={code}
        cursorIndex={cursorIndex}
        checkpoints={checkpoints}
        onStatus={setStatus}
        onError={(message) => setErrors((prev) => [...prev, message])}
      />
      <pre ref={readyRef} data-testid="probe" data-ready="false" />
      <pre data-testid="cursor">{cursorIndex}</pre>
      <pre data-testid="code-length">{code.length}</pre>
      <pre data-testid="checkpoints">{checkpoints.join(",")}</pre>
      <pre data-testid="status">{status}</pre>
      <pre data-testid="errors">{errors.join("\n")}</pre>
    </main>
  );
}

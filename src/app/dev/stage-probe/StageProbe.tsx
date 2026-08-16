"use client";

import { useEffect, useRef, useState } from "react";
import ShadowDOMStage from "@/components/stage/ShadowDOMStage";

export const CSS_SNIPPET = ".rocket { transform: translateY(-40px); opacity: 0.5; }";
export const SVG_SNIPPET = '<path d="M12 2L2 22h20Z" fill="rgb(255, 0, 0)" />';

declare global {
  interface Window {
    /** Playwright drives the cursor directly instead of clicking through 50 steps. */
    __setStageCursor?: (index: number) => void;
  }
}

export default function StageProbe() {
  const [cursorIndex, setCursorIndex] = useState(0);
  const [language, setLanguage] = useState<"css" | "svg">("css");
  const [errors, setErrors] = useState<string[]>([]);

  // Specs must not drive the probe before hydration registers the setter, or
  // page.evaluate silently no-ops and the assertion passes vacuously.
  const readyRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    window.__setStageCursor = setCursorIndex;
    readyRef.current?.setAttribute("data-ready", "true");
    return () => {
      delete window.__setStageCursor;
    };
  }, []);

  // Any error escaping the stage into the host page is exactly what §4.4 forbids.
  useEffect(() => {
    const onError = (event: ErrorEvent) => setErrors((prev) => [...prev, event.message]);
    const onRejection = (event: PromiseRejectionEvent) =>
      setErrors((prev) => [...prev, String(event.reason)]);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const code = language === "css" ? CSS_SNIPPET : SVG_SNIPPET;
  const initialStageHTML =
    language === "css"
      ? '<div class="rocket" style="width:40px;height:40px">rocket</div>'
      : '<svg viewBox="0 0 24 24" width="48" height="48"></svg>';

  return (
    <main style={{ fontFamily: "monospace", padding: 24 }}>
      <h1>Stage probe</h1>
      <button type="button" data-testid="lang-css" onClick={() => setLanguage("css")}>
        css
      </button>
      <button type="button" data-testid="lang-svg" onClick={() => setLanguage("svg")}>
        svg
      </button>

      <ShadowDOMStage
        key={language}
        initialStageHTML={initialStageHTML}
        language={language}
        code={code}
        cursorIndex={cursorIndex}
      />

      <pre ref={readyRef} data-testid="probe" data-ready="false" />
      <pre data-testid="cursor">{cursorIndex}</pre>
      <pre data-testid="code-length">{code.length}</pre>
      <pre data-testid="errors">{errors.join("\n")}</pre>
    </main>
  );
}

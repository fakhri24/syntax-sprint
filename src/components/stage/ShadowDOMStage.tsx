"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { Language } from "@/types/schema";

export interface ShadowDOMStageProps {
  /**
   * Curated, code-reviewed markup (AGENTS.md §4.8). It is trusted precisely
   * because there is no user-generated snippet pipeline — see invariant #4.
   */
  initialStageHTML: string;
  language: Extract<Language, "css" | "svg">;
  /** The full target. Only the prefix up to `cursorIndex` is ever injected. */
  code: string;
  cursorIndex: number;
}

/**
 * Live stage for declarative levels (AGENTS.md §4.4).
 *
 * The substring up to the cursor is injected on every accepted keystroke.
 * Half-typed tokens are expected and must degrade silently: the browser's own
 * error recovery drops an incomplete CSS declaration or SVG attribute, so the
 * stage simply renders a little less until the token completes.
 *
 * Everything lives inside a Shadow DOM so a typed selector can never reach the
 * surrounding app. Note this is encapsulation, not a security boundary — it is
 * sufficient here only because the injected text is always a prefix of a
 * curated snippet, never arbitrary input.
 */
export default function ShadowDOMStage({
  initialStageHTML,
  language,
  code,
  cursorIndex,
}: ShadowDOMStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const sinkRef = useRef<Element | null>(null);

  // Build the stage once per snippet. attachShadow throws if called twice on the
  // same host, so the root is created lazily and reused.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const shadow = shadowRef.current ?? host.attachShadow({ mode: "open" });
    shadowRef.current = shadow;
    shadow.innerHTML = initialStageHTML;

    sinkRef.current = resolveSink(shadow, language);

    return () => {
      shadow.innerHTML = "";
      sinkRef.current = null;
    };
  }, [initialStageHTML, language]);

  useEffect(() => {
    const sink = sinkRef.current;
    if (!sink) return;

    const prefix = code.slice(0, cursorIndex);

    if (language === "css") {
      // Assigning textContent to a <style> never throws; the CSS parser discards
      // whatever trailing fragment is not yet a complete rule.
      sink.textContent = prefix;
      return;
    }

    try {
      sink.innerHTML = prefix;
    } catch {
      // A markup fragment the parser cannot recover from would otherwise blank
      // the stage mid-word. Keep the last good render instead of flickering.
    }
  }, [code, cursorIndex, language]);

  return <div ref={hostRef} data-testid="shadow-stage" />;
}

/**
 * Where typed code goes. A snippet may nominate its own target with
 * `data-sink`; otherwise CSS gets a fresh <style> and SVG writes into the
 * stage's <svg> root.
 */
function resolveSink(shadow: ShadowRoot, language: "css" | "svg"): Element {
  const nominated = shadow.querySelector("[data-sink]");
  if (nominated) return nominated;

  if (language === "css") {
    const style = document.createElement("style");
    shadow.appendChild(style);
    return style;
  }

  const svg = shadow.querySelector("svg");
  if (svg) return svg;

  // A snippet that draws from nothing still needs somewhere to draw.
  const created = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  shadow.appendChild(created);
  return created;
}

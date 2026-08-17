"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import styles from "./CodeViewport.module.css";
import { diffCharStates, expandTokenColors, initialCharStates } from "./charStates";
import type { HighlightToken } from "@/types/schema";

export interface CodeViewportProps {
  code: string;
  /** Precomputed by Shiki at seed time; nothing is highlighted at runtime (§4.11). */
  tokens: HighlightToken[];
  /** True where a character is auto-skipped indentation (§4.2). */
  skipMask: boolean[];
  cursorIndex: number;
  hasError: boolean;
  /**
   * Increments on every error and every blocked keypress. The shake replays on
   * change, so mashing while locked keeps shaking (§4.3).
   */
  errorNonce: number;
}

interface CaretPosition {
  left: number;
  top: number;
  height: number;
}

/**
 * The typing viewport (AGENTS.md §4.11).
 *
 * Performance contract: the snippet DOM is built exactly once. A keystroke
 * mutates at most a couple of `data-state` attributes and moves the caret with a
 * transform. Nothing here re-renders, re-tokenizes, or reads layout during a run
 * — caret positions come from a table measured at mount and on resize.
 */
export default function CodeViewport({
  code,
  tokens,
  skipMask,
  cursorIndex,
  hasError,
  errorNonce,
}: CodeViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const charRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const positionsRef = useRef<CaretPosition[]>([]);
  const previousRef = useRef({ cursorIndex, hasError });

  const colors = useMemo(() => expandTokenColors(code.length, tokens), [code, tokens]);

  // Built once. Referentially stable, so React skips this subtree on every
  // subsequent render no matter how often the cursor moves.
  const spans = useMemo(() => {
    const states = initialCharStates(skipMask);
    return Array.from(code).map((char, index) => {
      const color = colors[index];
      return (
        <span
          key={index}
          ref={(node) => {
            charRefs.current[index] = node;
          }}
          className={styles.char}
          data-state={states[index]}
          data-index={index}
          style={
            color
              ? ({ "--tok-light": color.light, "--tok-dark": color.dark } as React.CSSProperties)
              : undefined
          }
        >
          {char}
        </span>
      );
    });
  }, [code, colors, skipMask]);

  const measure = () => {
    const container = containerRef.current;
    if (!container) return;
    const base = container.getBoundingClientRect();
    // One batched read pass: no writes interleave, so this costs a single layout.
    positionsRef.current = charRefs.current.map((node) => {
      if (!node) return { left: 0, top: 0, height: 0 };
      const rect = node.getBoundingClientRect();
      return { left: rect.left - base.left, top: rect.top - base.top, height: rect.height };
    });
  };

  const moveCaret = (index: number) => {
    const caret = caretRef.current;
    const position = positionsRef.current[index] ?? positionsRef.current.at(-1);
    if (!caret || !position) return;
    caret.style.height = `${position.height}px`;
    caret.style.transform = `translate(${position.left}px, ${position.top}px)`;
  };

  useLayoutEffect(() => {
    measure();
    moveCaret(cursorIndex);

    // The spans are built from skipMask alone, which knows nothing about the
    // cursor, and the diff below emits nothing while previous and next match.
    // So the very first character has to be marked here or it would sit under
    // the caret still styled as pending — invisible against the block.
    charRefs.current[cursorIndex]?.setAttribute("data-state", hasError ? "error" : "current");

    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    // Reflow changes every caret position, so the table is rebuilt — but only on
    // resize, never during typing.
    const observer = new ResizeObserver(() => {
      measure();
      moveCaret(previousRef.current.cursorIndex);
    });
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // The imperative hot path: a couple of attribute writes and one transform.
  useEffect(() => {
    const next = { cursorIndex, hasError };
    for (const { index, state } of diffCharStates(previousRef.current, next, skipMask)) {
      charRefs.current[index]?.setAttribute("data-state", state);
    }
    previousRef.current = next;

    moveCaret(cursorIndex);
    caretRef.current?.setAttribute("data-error", String(hasError));
  }, [cursorIndex, hasError, skipMask]);

  // Replay the shake on every error, including repeats while locked.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || errorNonce === 0) return;

    container.classList.remove(styles.shake);
    // Forced reflow restarts the animation. It happens only on error, never per
    // keystroke, so it stays outside the typing frame budget.
    void container.offsetWidth;
    container.classList.add(styles.shake);
  }, [errorNonce]);

  return (
    <div ref={containerRef} className={styles.viewport} data-testid="code-viewport">
      {spans}
      <span ref={caretRef} className={styles.caret} data-testid="caret" data-error="false" />
    </div>
  );
}

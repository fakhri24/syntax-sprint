"use client";

import { useEffect, useRef } from "react";
import { latestCheckpointAt } from "@/engine/checkpoints";
import { instrumentLoops } from "@/engine/loopGuard";

export type SandboxStatus = "loading" | "ready" | "error" | "timeout";

/**
 * How long the parent waits for an ACK before assuming the frame is wedged
 * (AGENTS.md §4.4). Generous next to any honest snippet, short enough that a
 * hang is not mistaken for slowness.
 */
export const ACK_TIMEOUT_MS = 750;

export interface IframeSandboxProps {
  /** Curated, code-reviewed markup (AGENTS.md §4.8). */
  initialStageHTML: string;
  code: string;
  cursorIndex: number;
  /** Offsets where the prefix is guaranteed to parse (§4.4). */
  checkpoints: number[];
  onError?: (message: string) => void;
  onStatus?: (status: SandboxStatus) => void;
}

interface ExecMessage {
  type: "EXEC";
  seq: number;
  code: string;
  html: string;
}

/**
 * Runs inside the sandboxed iframe. Kept as a string so it is unmistakably
 * separate from parent code — it executes in an opaque origin with no access
 * back into the app.
 *
 * Each EXEC resets the document and runs the whole prefix from scratch: there
 * is no incremental state across executions (§4.4). `new Function` rather than
 * `eval` gives every run its own scope, so re-running a prefix that declares a
 * `const` does not throw "already declared".
 */
const BOOTSTRAP = `
(function () {
  var post = function (message) { parent.postMessage(message, '*'); };

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'EXEC') return;
    try {
      document.body.innerHTML = data.html || '';
      new Function(data.code)();
      post({ type: 'ACK', seq: data.seq });
    } catch (error) {
      post({ type: 'ERROR', seq: data.seq, message: String((error && error.message) || error) });
    }
  });

  // Asynchronous failures never reach the EXEC try/catch. Note this does NOT
  // catch runaway loops, which block this frame's event loop entirely — and this
  // frame shares the parent's thread, so nothing on the parent side can notice
  // either. The loop guard applied before EXEC is what handles that (§4.4).
  window.onerror = function (message) {
    post({ type: 'ERROR', seq: -1, message: String(message) });
    return true;
  };

  post({ type: 'READY' });
})();
`;

function buildSrcDoc(): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body></body><script>${BOOTSTRAP}</script></html>`;
}

/**
 * Isolated JavaScript stage (AGENTS.md §4.4).
 *
 * `sandbox="allow-scripts"` **without** `allow-same-origin`: the frame gets an
 * opaque origin and cannot touch the parent document, cookies, or storage. That
 * combination also means messages arrive with `origin === "null"`, so the parent
 * authenticates them by comparing `event.source` against the frame's own window
 * rather than by checking an origin string.
 */
export default function IframeSandbox({
  initialStageHTML,
  code,
  cursorIndex,
  checkpoints,
  onError,
  onStatus,
}: IframeSandboxProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const seqRef = useRef(0);
  const executedRef = useRef(-1);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A prefix that wedged the frame; never retried until the target moves. */
  const quarantinedRef = useRef<number | null>(null);

  /**
   * The document is attached after mount, never during SSR. Rendering `srcdoc`
   * server-side lets the frame finish loading before hydration attaches
   * `onLoad`, and the readiness handshake is then missed entirely — the frame
   * sits idle forever. Assigning it here guarantees the load event comes after
   * the handler exists.
   */
  const attachedRef = useRef(false);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || attachedRef.current) return;
    attachedRef.current = true;
    frame.srcdoc = buildSrcDoc();
  }, []);

  const callbacks = useRef({ onError, onStatus });
  useEffect(() => {
    callbacks.current = { onError, onStatus };
  });

  // The prefix the stage should be showing: only statement boundaries qualify,
  // so this changes far less often than the cursor does.
  const target = latestCheckpointAt(checkpoints, cursorIndex);

  /**
   * The frame can finish loading and post READY before React attaches the
   * message listener, so readiness is driven by the parent-observed `load`
   * event — deterministic, because the bootstrap registers its listener
   * synchronously while the document parses. The READY message is kept as a
   * belt-and-braces path and is idempotent.
   */
  const markReady = () => {
    if (readyRef.current) return;
    readyRef.current = true;
    callbacks.current.onStatus?.("ready");
    execute(target);
  };

  const clearWatchdog = () => {
    if (watchdogRef.current === null) return;
    clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  };

  /**
   * Recovery when no ACK arrives. This covers a frame that failed to answer
   * while its thread is still alive — a bootstrap that never loaded, or a lost
   * message.
   *
   * It cannot rescue a synchronous spin: a srcdoc frame runs on the parent's
   * main thread, so the timer below would be frozen alongside it (§4.4, with
   * the measurement that established it). The loop guard handles that case.
   */
  const resetFrame = (wedgedTarget: number) => {
    const frame = frameRef.current;
    if (!frame) return;

    quarantinedRef.current = wedgedTarget;
    readyRef.current = false;
    executedRef.current = -1;
    callbacks.current.onStatus?.("timeout");
    callbacks.current.onError?.(`Stage reset: no response within ${ACK_TIMEOUT_MS}ms`);
    frame.srcdoc = buildSrcDoc();
  };

  const execute = (upTo: number) => {
    const frame = frameRef.current;
    if (!frame?.contentWindow || !readyRef.current) return;
    // Re-running a prefix that already wedged the frame would just wedge it again.
    if (quarantinedRef.current === upTo) return;

    // Instrumentation is unconditional: a srcdoc frame shares the parent's main
    // thread, so a synchronous spin freezes the whole page and the watchdog below
    // never gets to run. The loop guard is the only thing standing between a
    // runaway loop and a dead tab (AGENTS.md §4.4).
    let payload: string;
    try {
      payload = instrumentLoops(code.slice(0, upTo));
    } catch (error) {
      // A checkpoint prefix is meant to parse, so this means the checkpoint index
      // disagrees with the code. Report it rather than throwing out of an effect,
      // and run nothing rather than running unguarded.
      callbacks.current.onStatus?.("error");
      callbacks.current.onError?.(`Loop guard could not parse the prefix: ${(error as Error).message}`);
      return;
    }

    seqRef.current += 1;
    executedRef.current = upTo;
    const message: ExecMessage = {
      type: "EXEC",
      seq: seqRef.current,
      code: payload,
      html: initialStageHTML,
    };
    // targetOrigin must be '*': an opaque origin cannot be named.
    frame.contentWindow.postMessage(message, "*");

    clearWatchdog();
    watchdogRef.current = setTimeout(() => resetFrame(upTo), ACK_TIMEOUT_MS);
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // The only authentication available for an opaque origin.
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: string; message?: string };

      if (data?.type === "READY") {
        markReady();
        return;
      }
      if (data?.type === "ACK") {
        clearWatchdog();
        quarantinedRef.current = null;
        return;
      }
      if (data?.type === "ERROR") {
        // The frame answered, so it is alive — a thrown error is not a hang.
        clearWatchdog();
        callbacks.current.onStatus?.("error");
        callbacks.current.onError?.(data.message ?? "unknown error");
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearWatchdog();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (target === executedRef.current) return;
    execute(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, code, initialStageHTML]);

  return (
    <iframe
      ref={frameRef}
      data-testid="iframe-sandbox"
      title="JavaScript stage"
      sandbox="allow-scripts"
      // The initial about:blank load also fires here; only the bootstrap counts.
      onLoad={() => attachedRef.current && markReady()}
    />
  );
}

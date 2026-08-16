"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import CodeViewport from "@/components/editor/CodeViewport";
import ShadowDOMStage from "@/components/stage/ShadowDOMStage";
import IframeSandbox from "@/components/stage/IframeSandbox";
import ScoringNotice from "@/components/auth/ScoringNotice";
import CompletionSummary from "./CompletionSummary";
import { useRunSubmission } from "./useRunSubmission";
import {
  createRunStore,
  selectCursor,
  selectErrorNonce,
  selectHasError,
  selectPhase,
} from "./runStore";
import { attachInputController } from "@/engine/input";
import { buildLayout } from "@/engine/layout";
import { computeMetrics } from "@/engine/metrics";
import { runElapsedMs } from "@/engine/keystroke";
import { createAudioEngine, soundForEffect } from "@/lib/audio";
import { useAuth } from "@/components/auth/AuthProvider";
import Link from "next/link";
import styles from "./Arena.module.css";
import type { Snippet } from "@/types/schema";

export interface ArenaProps {
  snippet: Snippet;
}

/**
 * The game arena (PLAN 4.3).
 *
 * Everything here is wiring; the behaviour lives in the engine. The one rule
 * this component owns is that a keystroke must not become a React render of the
 * snippet: input goes straight into the store, and only the cursor-shaped
 * selectors re-render anything (§4.11).
 */
export default function Arena({ snippet }: ArenaProps) {
  const store = useMemo(() => createRunStore(snippet.targetCode), [snippet.targetCode]);
  const layout = useMemo(() => buildLayout(snippet.targetCode), [snippet.targetCode]);

  const cursorIndex = useStore(store, selectCursor);
  const hasError = useStore(store, selectHasError);
  const errorNonce = useStore(store, selectErrorNonce);
  const phase = useStore(store, selectPhase);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<ReturnType<typeof createAudioEngine> | null>(null);
  const submittedRef = useRef(false);
  const [muted, setMuted] = useState(false);

  const { user } = useAuth();
  const getIdToken = useCallback(async () => (user ? getToken() : null), [user]);
  const { reserved, state: submission, submit } = useRunSubmission({
    snippetId: snippet.id,
    getIdToken,
  });

  useEffect(() => {
    audioRef.current = createAudioEngine();
    return () => audioRef.current?.dispose();
  }, []);

  useEffect(() => {
    const target = inputRef.current;
    if (!target) return;
    target.focus();

    return attachInputController({
      target,
      onInput: (input) => {
        // Browsers only start audio from a gesture, and a keystroke is one.
        void audioRef.current?.resume();
        const effect = store.getState().apply(input, performance.now());
        const sound = soundForEffect(effect);
        if (sound) audioRef.current?.play(sound);
      },
      onIgnored: () => {},
    });
  }, [store]);

  // Submit exactly once, when the run finishes.
  useEffect(() => {
    if (phase !== "FINISHED" || submittedRef.current) return;
    submittedRef.current = true;
    void submit(store.getState().telemetry);
  }, [phase, store, submit]);

  const restart = () => {
    submittedRef.current = false;
    store.getState().reset();
    inputRef.current?.focus();
  };

  const run = useStore(store, (state) => state.run);

  // Only computed for a finished run. The clock freezes at the final keystroke
  // (§4.3), so `runElapsedMs` ignores the `now` argument here — which is what
  // lets this stay a pure render with no clock read. While a run is still
  // RUNNING that is not true, and passing a fake `now` would produce a negative
  // elapsed time; the live figures come from `useLiveMetrics` instead.
  const localMetrics =
    phase === "FINISHED"
      ? computeMetrics({
          correctKeystrokes: run.correctKeystrokes,
          totalErrors: run.totalErrors,
          elapsedMs: runElapsedMs(run, run.clock.finishedAt ?? 0),
        })
      : null;

  return (
    <main className={`sheet ${styles.arena}`} data-testid="arena" data-phase={phase}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <Link href="/" className={styles.back}>
            Levels
          </Link>
          <h1>{snippet.title}</h1>
        </div>
        <div className={styles.controls}>
          <button
            type="button"
            data-testid="mute"
            aria-pressed={muted}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              audioRef.current?.setEnabled(!next);
            }}
          >
            {muted ? "Sound off" : "Sound on"}
          </button>
        </div>
      </header>

      <div className={styles.runStatus}>
        <ScoringNotice />
        {/* The run cannot start before we know whether it will score, or a player
            could finish a run that silently never counted (§4.6). */}
        {!reserved ? (
          <p className={styles.preparing} aria-busy="true">
            Reserving your run…
          </p>
        ) : null}
      </div>

      <div className={styles.split} data-testid="split">
        <section className={styles.pane} aria-label="Editor">
          <p className={styles.paneLabel}>Type this</p>
          <textarea
            ref={inputRef}
            className={styles.hiddenInput}
            data-testid="input-target"
            aria-label="Type the snippet"
          />
          <CodeViewport
            code={snippet.targetCode}
            tokens={snippet.tokens}
            skipMask={layout.skipMask}
            cursorIndex={cursorIndex}
            hasError={hasError}
            errorNonce={errorNonce}
          />
        </section>

        <section className={styles.pane} aria-label="Stage">
          <p className={styles.paneLabel}>What it draws</p>
          <div className={styles.stage}>
          {snippet.language === "javascript" ? (
            <IframeSandbox
              initialStageHTML={snippet.initialStageHTML}
              code={snippet.targetCode}
              cursorIndex={cursorIndex}
              checkpoints={snippet.checkpoints}
            />
          ) : (
            <ShadowDOMStage
              initialStageHTML={snippet.initialStageHTML}
              language={snippet.language}
              code={snippet.targetCode}
              cursorIndex={cursorIndex}
            />
          )}
          </div>
        </section>
      </div>

      {localMetrics ? (
        <CompletionSummary local={localMetrics} submission={submission} onRestart={restart} />
      ) : null}
    </main>
  );
}

/** Firebase's current ID token, refreshed by the SDK as needed. */
async function getToken(): Promise<string | null> {
  const { getFirebaseAuth } = await import("@/lib/firebase");
  return (await getFirebaseAuth().currentUser?.getIdToken()) ?? null;
}

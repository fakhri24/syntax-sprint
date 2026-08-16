"use client";

import Link from "next/link";
import { NET_WPM_LABEL } from "@/engine/metrics";
import styles from "./CompletionSummary.module.css";
import type { SubmissionState } from "./useRunSubmission";
import type { Metrics } from "@/types/game";

export interface CompletionSummaryProps {
  /** What the client measured. Authoritative numbers come from the server. */
  local: Metrics;
  submission: SubmissionState;
  onRestart: () => void;
}

const wpm = (value: number) => value.toFixed(1);

/**
 * End-of-run proof sheet.
 *
 * Shows the client's own numbers immediately, then replaces them with the
 * server's once they arrive — the server recomputes from telemetry (§4.6), and
 * the two can differ by a rounding step. Presenting the local figure as final
 * would make an honest discrepancy look like a bug.
 */
export default function CompletionSummary({ local, submission, onRestart }: CompletionSummaryProps) {
  const official = submission.status === "submitted" ? submission.result : null;
  const shown = official ?? local;

  return (
    <section className={styles.summary} data-testid="completion" aria-live="polite">
      <div className={styles.heading}>
        <h2>Off the press</h2>
        <p className="eyebrow" style={{ margin: 0 }}>
          {official ? "Server verified" : "Your machine"}
        </p>
      </div>

      <dl className={styles.figures}>
        <div className={styles.figure} data-lead="true">
          <dt>{NET_WPM_LABEL}</dt>
          <dd data-testid="summary-net">{wpm(shown.netWpm)}</dd>
        </div>
        <div className={styles.figure}>
          <dt>Gross WPM</dt>
          <dd data-testid="summary-gross">{wpm(shown.grossWpm)}</dd>
        </div>
        <div className={styles.figure}>
          <dt>Accuracy</dt>
          <dd data-testid="summary-accuracy">{Math.round(shown.accuracy * 100)}%</dd>
        </div>
        <div className={styles.figure}>
          <dt>Time</dt>
          <dd data-testid="summary-time">{(shown.elapsedMs / 1000).toFixed(1)}s</dd>
        </div>
      </dl>

      {submission.status === "submitting" ? (
        <p className={styles.status} data-testid="submit-pending">
          Sending your run…
        </p>
      ) : null}

      {submission.status === "not-scored" ? (
        <p className={styles.status} data-testid="submit-practice">
          Practice run — nothing was submitted. <Link href="/login">Sign in</Link>, then start a run
          to put it on the board.
        </p>
      ) : null}

      {submission.status === "failed" ? (
        <p className={styles.status} data-tone="problem" role="alert" data-testid="submit-failed">
          Not submitted: {submission.error}
        </p>
      ) : null}

      {official ? (
        <p
          className={styles.status}
          data-tone={official.personalBest.snippet ? "best" : undefined}
          data-testid="submit-ok"
        >
          {official.personalBest.snippet
            ? "Your fastest run on this level yet."
            : "Submitted. Your best on this level still stands."}
          {official.verified ? null : " Held for review."}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button type="button" data-testid="restart" onClick={onRestart}>
          Run it again
        </button>
        <Link href="/leaderboard">Leaderboard</Link>
      </div>
    </section>
  );
}

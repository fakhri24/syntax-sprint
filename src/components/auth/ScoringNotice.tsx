"use client";

import { canSubmitRuns, useAuth } from "./AuthProvider";
import styles from "./auth.module.css";

/**
 * States whether *this* run will count, before it starts (PLAN 3.1).
 *
 * A run only scores if the player was signed in before typing began (§4.6), so
 * discovering the requirement on the completion screen would mean the run is
 * already lost. This component exists to make sure that never happens.
 */
export default function ScoringNotice() {
  const { status, signIn } = useAuth();

  if (status === "loading") {
    return (
      <p className={styles.notice} data-testid="scoring-notice" data-scoring="unknown">
        Checking your session…
      </p>
    );
  }

  if (canSubmitRuns(status)) {
    return (
      <p className={styles.notice} data-testid="scoring-notice" data-scoring="yes">
        This run counts. It goes to the leaderboard when you finish.
      </p>
    );
  }

  return (
    <p className={styles.notice} data-testid="scoring-notice" data-scoring="no">
      Practice run — it stays on your machine.{" "}
      <button type="button" className={styles.inlineButton} onClick={() => void signIn()}>
        Sign in with Google
      </button>{" "}
      before you start to make it count.
    </p>
  );
}

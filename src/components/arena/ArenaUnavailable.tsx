import Link from "next/link";
import styles from "./ArenaUnavailable.module.css";

export interface ArenaUnavailableProps {
  /** Ties this screen to the line the server logged when the read failed. */
  reference: string;
  /** The same level, re-requested from the server. */
  retryHref: string;
}

/**
 * Shown when the snippet cannot be read from Firestore.
 *
 * A Server Component on purpose. It renders precisely because something
 * server-side already failed, so it must not need client JavaScript to appear —
 * every action here is a plain navigation.
 */
export default function ArenaUnavailable({ reference, retryHref }: ArenaUnavailableProps) {
  return (
    <main className={styles.panel} data-testid="arena-unavailable">
      <p className="eyebrow">Level unavailable</p>
      <h1>The plate is missing</h1>

      <div className={styles.body}>
        <p className="lede">
          This level could not be read from the server. Nothing is wrong with your setup, and no
          score of yours was affected.
        </p>

        <p className={styles.reference}>
          <span className={styles.referenceLabel}>Ref</span>
          <span className={styles.referenceValue}>{reference}</span>
        </p>

        <p className={styles.footnote}>Quote this reference when reporting the failure.</p>
      </div>

      <div className={styles.actions}>
        <a href={retryHref} className={styles.retry}>
          Try again
        </a>
        <Link href="/">Back to home</Link>
        <Link href="/leaderboard">See the leaderboard</Link>
      </div>
    </main>
  );
}

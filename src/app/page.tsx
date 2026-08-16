import Link from "next/link";
import AuthBadge from "@/components/auth/AuthBadge";
import { SNIPPET_MANIFESTS } from "../../content/snippets";
import styles from "./page.module.css";

/**
 * Level select. Public and responsive: signing in is only needed to submit a
 * score (AGENTS.md invariant #3), and the arena's own gate handles devices
 * without a keyboard (§4.9).
 */
export default function HomePage() {
  return (
    <main className="sheet">
      <header className={styles.masthead}>
        <h1 className={styles.wordmark} data-word="Syntax Sprint">
          Syntax Sprint
        </h1>
        <AuthBadge />
      </header>

      <p className={`lede ${styles.tagline}`}>
        Type real code against the clock. Every character you land <em>runs immediately</em> — the
        rocket climbs, the badge draws itself, the card wakes up.
      </p>

      <section className={styles.levelSection}>
        <p className="eyebrow">Three levels</p>
        <ul className={styles.levels}>
          {SNIPPET_MANIFESTS.map((snippet, index) => (
            <li key={snippet.id} className={styles.level}>
              <Link href={`/play/${snippet.id}`} className={styles.levelLink}>
                <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.title}>{snippet.title}</span>
                <span className={styles.meta}>
                  <span className={styles.chip}>{snippet.language}</span>
                  <span className={styles.chip} data-difficulty={snippet.difficulty}>
                    {snippet.difficulty}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <nav className={styles.footer}>
        <Link href="/leaderboard">Leaderboard</Link>
        <Link href="/login">Sign in to compete</Link>
      </nav>
    </main>
  );
}

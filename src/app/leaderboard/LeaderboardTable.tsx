"use client";

/* eslint-disable @next/next/no-img-element -- avatars come from Google's CDN at
   arbitrary hosts; next/image would need every provider domain configured. */

import { NET_WPM_LABEL } from "@/engine/metrics";
import styles from "./leaderboard.module.css";
import type { LeaderboardEntry } from "@/types/schema";

export interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  /** Shown when the board is global, where a score can come from any level. */
  showSnippet?: boolean;
  emptyMessage?: string;
}

export default function LeaderboardTable({
  entries,
  showSnippet = false,
  emptyMessage = "Nobody has finished this one yet. Be the first name on it.",
}: LeaderboardTableProps) {
  if (entries.length === 0) {
    return (
      <p className={styles.empty} data-testid="leaderboard-empty">
        {emptyMessage}
      </p>
    );
  }

  return (
    <table className={styles.table} data-testid="leaderboard-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Player</th>
          {showSnippet ? <th scope="col">Level</th> : null}
          {/* Never just "Net WPM": this is not the standard definition (§4.5). */}
          <th scope="col">{NET_WPM_LABEL}</th>
          <th scope="col">Gross WPM</th>
          <th scope="col">Accuracy</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => (
          <tr
            key={`${entry.snippetId}__${entry.uid}`}
            className={styles.row}
            data-testid="leaderboard-row"
          >
            <td className={styles.rank}>{String(index + 1).padStart(2, "0")}</td>
            <td>
              <span className={styles.player}>
                {entry.photoURL ? (
                  <img className={styles.avatar} src={entry.photoURL} alt="" width={20} height={20} />
                ) : null}
                {entry.displayName}
              </span>
            </td>
            {showSnippet ? <td className={styles.level}>{entry.snippetId}</td> : null}
            <td className={styles.lead}>{entry.netWpm.toFixed(1)}</td>
            <td>{entry.grossWpm.toFixed(1)}</td>
            <td>{Math.round(entry.accuracy * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

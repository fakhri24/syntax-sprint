"use client";

import { useEffect, useState } from "react";
import LeaderboardTable from "./LeaderboardTable";
import { getDb } from "@/lib/firebase";
import { fetchGlobalLeaderboard, fetchSnippetLeaderboard } from "@/lib/leaderboardQueries";
import { SNIPPET_MANIFESTS } from "../../../content/snippets";
import styles from "./leaderboard.module.css";
import Link from "next/link";
import type { LeaderboardEntry } from "@/types/schema";

type Scope = "global" | string;

interface Loaded {
  scope: Scope;
  entries: LeaderboardEntry[];
}

export default function LeaderboardView() {
  const [scope, setScope] = useState<Scope>("global");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failedScope, setFailedScope] = useState<Scope | null>(null);

  // Derived rather than stored: "loading" is simply "what is on screen is not
  // what was asked for". That keeps the effect free of synchronous state writes
  // and makes a stale response impossible to paint.
  const isLoading = loaded?.scope !== scope && failedScope !== scope;

  useEffect(() => {
    let cancelled = false;

    const load =
      scope === "global" ? fetchGlobalLeaderboard(getDb()) : fetchSnippetLeaderboard(getDb(), scope);

    load
      .then((entries) => {
        if (cancelled) return;
        // Clear any earlier failure for this scope: without it a transient error
        // leaves the banner up permanently, alongside the data that did arrive.
        setFailedScope((failed) => (failed === scope ? null : failed));
        setLoaded({ scope, entries });
      })
      .catch(() => {
        if (!cancelled) setFailedScope(scope);
      });

    return () => {
      cancelled = true;
    };
  }, [scope]);

  return (
    <main className="sheet">
      <header className={styles.header}>
        <h1>Leaderboard</h1>
        <Link href="/">Back to levels</Link>
      </header>

      <nav className={styles.scopes} aria-label="Leaderboard scope">
        <button
          type="button"
          data-testid="scope-global"
          aria-pressed={scope === "global"}
          onClick={() => setScope("global")}
        >
          Global
        </button>
        {SNIPPET_MANIFESTS.map((snippet) => (
          <button
            key={snippet.id}
            type="button"
            data-testid={`scope-${snippet.id}`}
            aria-pressed={scope === snippet.id}
            onClick={() => setScope(snippet.id)}
          >
            {snippet.title}
          </button>
        ))}
      </nav>

      {isLoading ? (
        <p className={styles.notice} aria-busy="true">
          Loading…
        </p>
      ) : null}
      {failedScope === scope ? (
        <p className={styles.notice} data-tone="problem" role="alert">
          The leaderboard did not load. Check your connection and reload the page.
        </p>
      ) : null}
      {loaded?.scope === scope ? (
        <LeaderboardTable entries={loaded.entries} showSnippet={scope === "global"} />
      ) : null}
    </main>
  );
}

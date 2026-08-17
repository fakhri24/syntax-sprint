"use client";

import { useEffect } from "react";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import styles from "./global-error.module.css";

/**
 * The boundary of last resort.
 *
 * `error.tsx` cannot catch a Server Component that throws before the shell has
 * flushed: the boundary is never established server-side, so React falls
 * through to Next's built-in global error page. A failed `getAdminDb()` on
 * /play/[id] is exactly that shape — bad credentials in production render the
 * generic "This page couldn't load" screen, not our own. This replaces it.
 *
 * Because global-error substitutes for the root layout rather than nesting
 * inside it, nothing from layout.tsx runs. This file owns <html> and <body>,
 * imports the stylesheet itself, and re-declares the font variables — the
 * configs below deliberately mirror layout.tsx so next/font reuses the same
 * self-hosted files instead of emitting a second copy.
 */

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global application error:", error);
  }, [error]);

  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">
        <title>Syntax Sprint — server error</title>

        <main className={`sheet ${styles.panel}`}>
          <p className="eyebrow">Server error</p>
          <h1>The press jammed</h1>

          <p className="lede">
            Something failed on the server before this page could print. It is not something you
            did, and nothing you typed was lost.
          </p>

          {error.digest ? (
            <>
              <p className={styles.digest}>
                <span className={styles.digestLabel}>Digest</span>
                <span className={styles.digestValue}>{error.digest}</span>
              </p>
              <p className={styles.hint}>
                Quote this when reporting the failure — it names the matching line in the server
                log.
              </p>
            </>
          ) : null}

          {/*
            Production redacts `error.message` to a fixed placeholder, so showing
            it there would be theatre. In development it is the real thing.
          */}
          {process.env.NODE_ENV === "development" && error.message ? (
            <pre className={styles.trace}>{error.message}</pre>
          ) : null}

          <div className={styles.actions}>
            <button type="button" onClick={reset}>
              Try again
            </button>
            {/*
              A plain anchor, not next/link: the app shell is the thing that just
              failed, so a full document load is the point rather than a cost.
              The lint rule optimises for client-side navigation, which is
              precisely what must not happen here.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className={styles.homeLink}>
              Back to home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}

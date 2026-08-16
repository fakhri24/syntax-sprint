"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <main className="sheet">
      <header>
        <h1 className="wordmark">Unable to load level</h1>
      </header>
      <p className="lede">
        {error.message || "An unexpected error occurred while loading the level."}
      </p>
      <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            background: "var(--ink)",
            color: "var(--paper)",
            border: "none",
            padding: "10px 20px",
            fontFamily: "var(--font-display)",
            cursor: "pointer",
            borderRadius: "4px",
          }}
        >
          Try again
        </button>
        <Link
          href="/"
          style={{
            background: "transparent",
            color: "var(--ink)",
            border: "2px solid var(--ink)",
            padding: "8px 18px",
            fontFamily: "var(--font-display)",
            textDecoration: "none",
            display: "inline-block",
            borderRadius: "4px",
          }}
        >
          Back to Home
        </Link>
      </div>
    </main>
  );
}

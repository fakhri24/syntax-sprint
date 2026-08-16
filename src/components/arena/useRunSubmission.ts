"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildSubmission } from "@/engine/telemetry";
import type { TelemetryBuffer } from "@/types/game";

export interface SubmitResult {
  runId: string;
  verified: boolean;
  flags: string[];
  grossWpm: number;
  netWpm: number;
  accuracy: number;
  elapsedMs: number;
  personalBest: { snippet: boolean; global: boolean };
}

export type SubmissionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "submitted"; result: SubmitResult }
  /** Practice mode: no token was held, so there is nothing to submit. */
  | { status: "not-scored" }
  | { status: "failed"; error: string };

type Reservation = { status: "pending" } | { status: "ready"; willScore: boolean };

export interface UseRunSubmissionOptions {
  snippetId: string;
  /** Resolves to a Firebase ID token, or null when signed out. */
  getIdToken: () => Promise<string | null>;
}

/**
 * Owns the run token lifecycle (AGENTS.md §4.6, §4.13).
 *
 * The token is fetched **before** typing starts. That is the whole reason a
 * guest run cannot be submitted after the fact, and it is why this hook reserves
 * the token on mount rather than at completion — by completion it is too late,
 * and the player would have earned a score they cannot keep.
 */
export function useRunSubmission({ snippetId, getIdToken }: UseRunSubmissionOptions) {
  const tokenRef = useRef<string | null>(null);
  // Whether the run will score is state, not a ref read: the arena renders from
  // it, and a ref would not re-render when the reservation resolves.
  const [reservation, setReservation] = useState<Reservation>({ status: "pending" });
  const [state, setState] = useState<SubmissionState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const idToken = await getIdToken();
      if (cancelled) return;

      // Signed out: play normally, score nothing. Not an error state.
      if (!idToken) {
        setReservation({ status: "ready", willScore: false });
        return;
      }

      try {
        const response = await fetch("/api/runs/start", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ snippetId }),
        });
        if (!cancelled && response.ok) {
          tokenRef.current = (await response.json()).runToken;
        }
      } catch {
        // A failed reservation degrades to practice mode rather than blocking
        // the level: the player can still type, they just cannot score.
      } finally {
        if (!cancelled) {
          setReservation({ status: "ready", willScore: tokenRef.current !== null });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [snippetId, getIdToken]);

  const submit = useCallback(
    async (telemetry: TelemetryBuffer) => {
      const runToken = tokenRef.current;
      if (!runToken) {
        setState({ status: "not-scored" });
        return;
      }

      setState({ status: "submitting" });
      try {
        const idToken = await getIdToken();
        if (!idToken) {
          setState({ status: "not-scored" });
          return;
        }

        const response = await fetch("/api/runs/submit", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
          body: JSON.stringify(buildSubmission(telemetry, { runToken, snippetId })),
        });

        const body = await response.json();
        if (!response.ok) {
          setState({ status: "failed", error: body?.error ?? "Submission failed" });
          return;
        }

        setState({ status: "submitted", result: body as SubmitResult });
      } catch {
        setState({ status: "failed", error: "Could not reach the server" });
      } finally {
        // Single-use: the server would reject a replay anyway, but not offering
        // one keeps a retry button from looking like it might work.
        tokenRef.current = null;
      }
    },
    [getIdToken, snippetId],
  );

  return {
    /** True once we know whether this run can score — the arena waits for it. */
    reserved: reservation.status === "ready",
    willScore: reservation.status === "ready" && reservation.willScore,
    state,
    submit,
  };
}

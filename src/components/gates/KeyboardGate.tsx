"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  GATE_MESSAGES,
  gateReason,
  readDeviceSignals,
  type DeviceSignals,
  type GateReason,
} from "./deviceCapability";
import styles from "./gate.module.css";

/** Remembered for the session so the hatch is not re-offered on every level. */
export const OVERRIDE_KEY = "syntax-sprint:keyboard-override";

function readOverride(): boolean {
  try {
    return window.sessionStorage.getItem(OVERRIDE_KEY) === "1";
  } catch {
    // Private browsing can make sessionStorage throw. Losing the override is a
    // small annoyance; crashing the arena is not acceptable.
    return false;
  }
}

function storeOverride() {
  try {
    window.sessionStorage.setItem(OVERRIDE_KEY, "1");
  } catch {
    // Same reasoning: proceed without remembering.
  }
}

export interface KeyboardGateProps {
  children: ReactNode;
  /** Injectable for tests; defaults to reading the real browser signals. */
  readSignals?: () => DeviceSignals | null;
}

/**
 * Shows an explanatory interstitial instead of a broken arena (AGENTS.md §4.9).
 *
 * Nothing is decided during render: signals only exist in the browser, so the
 * first paint must match the server's, and the gate resolves after mount.
 */
export default function KeyboardGate({ children, readSignals = readDeviceSignals }: KeyboardGateProps) {
  const [signals, setSignals] = useState<DeviceSignals | null>(null);
  const [overridden, setOverridden] = useState(false);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    const update = () => {
      setSignals(readSignals());
      setOverridden(readOverride());
      setResolved(true);
    };
    update();

    // A window resized across the threshold should change the answer, rather
    // than stranding someone who widened their browser to comply.
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [readSignals]);

  // Before the signals are known, render nothing rather than guessing — a wrong
  // guess would flash either the gate or the arena on every load.
  if (!resolved) return null;

  const reason: GateReason = signals ? gateReason(signals) : null;
  if (!reason || overridden) return <>{children}</>;

  return (
    <main className={styles.gate} data-testid="desktop-required" data-reason={reason}>
      <p className="eyebrow">Needs a keyboard</p>
      <h1>Not this screen</h1>

      <div className={styles.body}>
        <p className="lede">{GATE_MESSAGES[reason]}</p>
        {/* Detection is a proxy, not a verdict: a tablet with a keyboard case is
            a real setup, and runs started through here score normally (§4.9). */}
        <p className={styles.footnote}>
          Runs started this way are scored like any other.
        </p>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          data-testid="enter-anyway"
          onClick={() => {
            storeOverride();
            setOverridden(true);
          }}
        >
          I have a keyboard
        </button>
        <Link href="/leaderboard">See the leaderboard</Link>
      </div>
    </main>
  );
}

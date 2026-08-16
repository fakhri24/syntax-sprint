"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import styles from "./login.module.css";

export default function LoginPanel() {
  const { user, status, error, signIn, signOut } = useAuth();

  if (status === "loading") {
    return (
      <main className={`sheet ${styles.panel}`} aria-busy="true">
        Checking your session…
      </main>
    );
  }

  if (user) {
    return (
      <main className={styles.panel}>
        <p className="eyebrow">Signed in</p>
        <h1>{user.displayName}</h1>
        <div className={styles.body}>
          <p className="lede" data-testid="signed-in-as">
            Your runs go to the leaderboard from here on.
          </p>
        </div>
        <div className={styles.actions}>
          <Link href="/">Pick a level</Link>
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.panel}>
      <p className="eyebrow">Optional</p>
      <h1>Sign in to compete</h1>

      <div className={styles.body}>
        <p className="lede">
          Every level is playable without an account. Signing in only decides whether your runs
          reach the leaderboard.
        </p>
        <p className={styles.warning}>
          A run counts only if you sign in <strong>before</strong> you start typing. Sign in first,
          then pick a level.
        </p>
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={() => void signIn()}>
          Sign in with Google
        </button>
        <Link href="/">Play without an account</Link>
      </div>

      {error ? (
        <p className={styles.error} role="alert" data-testid="login-error">
          Sign-in did not complete: {error}
        </p>
      ) : null}
    </main>
  );
}

"use client";

/* eslint-disable @next/next/no-img-element -- avatars come from Google's CDN
   at arbitrary hosts; next/image would need every provider domain configured. */

import { useAuth } from "./AuthProvider";
import styles from "./auth.module.css";

/** Session indicator: who you are, or a way to become someone. */
export default function AuthBadge() {
  const { user, status, signIn, signOut } = useAuth();

  if (status === "loading") {
    return (
      <span
        className={styles.placeholder}
        data-testid="auth-badge"
        data-state="loading"
        aria-busy="true"
      />
    );
  }

  if (!user) {
    return (
      <button type="button" data-testid="auth-badge" data-state="signed-out" onClick={() => void signIn()}>
        Sign in with Google
      </button>
    );
  }

  return (
    <span className={styles.badge} data-testid="auth-badge" data-state="signed-in">
      {user.photoURL ? (
        <img className={styles.avatar} src={user.photoURL} alt="" width={24} height={24} />
      ) : null}
      <span>{user.displayName}</span>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </span>
  );
}

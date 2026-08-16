"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { getFirebaseAuth, googleProvider } from "@/lib/firebase";

export interface AuthUser {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

export type AuthStatus = "loading" | "signed-in" | "signed-out";

export interface AuthValue {
  user: AuthUser | null;
  status: AuthStatus;
  /** Set when sign-in genuinely failed. Cancelling the popup is not a failure. */
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Google sign-in for scoring (AGENTS.md invariant #3).
 *
 * Authentication gates *submission*, not play. Everything below assumes a
 * signed-out visitor is a normal, welcome state rather than an error to recover
 * from — the arena works fine without it.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setStatus("signed-out");
        return;
      }
      setUser({
        uid: firebaseUser.uid,
        displayName: firebaseUser.displayName ?? "Anonymous",
        email: firebaseUser.email ?? "",
        photoURL: firebaseUser.photoURL ?? "",
      });
      setStatus("signed-in");
    });
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      status,
      error,
      async signIn() {
        setError(null);
        try {
          await signInWithPopup(getFirebaseAuth(), googleProvider);
        } catch (caught) {
          const code = (caught as { code?: string }).code;

          // Changing your mind is not an error, and showing a red banner for it
          // reads as though something broke.
          if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
            return;
          }

          // Popup blockers are common enough that failing here would strand
          // real users who did nothing wrong.
          if (code === "auth/popup-blocked") {
            await signInWithRedirect(getFirebaseAuth(), googleProvider);
            return;
          }

          setError((caught as Error).message ?? "Sign-in failed");
        }
      },
      async signOut() {
        setError(null);
        await firebaseSignOut(getFirebaseAuth());
      },
    }),
    [user, status, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/**
 * Whether this visitor can start a *scoring* run. A run only counts if the
 * player was signed in before it began (§4.6), so this is what the pre-run UI
 * must key off — never a check made after the run is over.
 */
export function canSubmitRuns(status: AuthStatus): boolean {
  return status === "signed-in";
}

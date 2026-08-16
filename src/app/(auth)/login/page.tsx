import type { Metadata } from "next";
import LoginPanel from "./LoginPanel";

export const metadata: Metadata = {
  title: "Sign in — Syntax Sprint",
};

/**
 * Signing in is optional (AGENTS.md invariant #3): the arena works without it.
 * This page exists for players who want their runs to count, not as a wall in
 * front of the game.
 */
export default function LoginPage() {
  return <LoginPanel />;
}

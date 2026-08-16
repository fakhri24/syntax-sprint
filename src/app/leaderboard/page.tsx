import type { Metadata } from "next";
import LeaderboardView from "./LeaderboardView";

export const metadata: Metadata = {
  title: "Leaderboard — Syntax Sprint",
};

/**
 * Public: signing in is only needed to *submit* a run (AGENTS.md invariant #3),
 * and the mobile gate links here so a phone visitor still has somewhere to go.
 */
export default function LeaderboardPage() {
  return <LeaderboardView />;
}

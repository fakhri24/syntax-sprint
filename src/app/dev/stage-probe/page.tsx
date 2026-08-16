import { notFound } from "next/navigation";
import StageProbe from "./StageProbe";

/**
 * Development-only harness for the Playwright stage specs (AGENTS.md §4.4).
 * jsdom's CSS parser is far stricter than a browser's, so "partial tokens
 * degrade silently" can only be proven in a real engine.
 */
export default function StageProbePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <StageProbe />;
}

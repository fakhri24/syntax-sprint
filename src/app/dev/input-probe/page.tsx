import { notFound } from "next/navigation";
import InputProbe from "./InputProbe";

/**
 * Development-only harness for the Playwright input specs (AGENTS.md §4.1).
 * jsdom cannot produce a real keyboard layout, a dead-key sequence, or an IME
 * composition, so those are asserted against this page in a real browser.
 * It is not part of the game and 404s outside development.
 */
export default function InputProbePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <InputProbe />;
}

import { notFound } from "next/navigation";
import SandboxProbe from "./SandboxProbe";

/**
 * Development-only harness for the Playwright sandbox specs (AGENTS.md §4.4).
 * jsdom does not execute scripts inside an iframe srcdoc, so the EXEC/ACK
 * protocol can only be exercised in a real browser.
 */
export default function SandboxProbePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SandboxProbe />;
}

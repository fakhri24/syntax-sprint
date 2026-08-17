export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEMPORARY — delete once the production 500 is diagnosed.
 *
 * Imports nothing, deliberately. That is the whole point: every other dynamic
 * route on this deployment returns 500 with an empty body while the identical
 * build answers correctly under `next start`, so the open question is whether
 * the Node function starts at all.
 *
 *   - responds 200  -> the function is healthy, and the fault is in what the
 *                      other routes import (the firebase-admin graph)
 *   - returns 500   -> the function never starts, and no application code is
 *                      involved in the failure
 *
 * Reports presence and shape only. No secret value is ever read into the
 * response — `privateKeyShape` answers "is this PEM well-formed" without
 * disclosing a single byte of the key.
 */

const REQUIRED = [
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "RUN_TOKEN_SECRET",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
] as const;

export async function GET() {
  const key = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";

  return Response.json({
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    envPresent: Object.fromEntries(REQUIRED.map((name) => [name, Boolean(process.env[name])])),
    privateKeyShape: {
      length: key.length,
      // The question from the very first screenshot: real spaces in the header,
      // or the underscores the editor appeared to show?
      headerExact: key.trimStart().startsWith("-----BEGIN PRIVATE KEY-----"),
      footerExact: key.trimEnd().endsWith("-----END PRIVATE KEY-----"),
      hasRealNewlines: key.includes("\n"),
      hasEscapedNewlines: key.includes("\\n"),
      wrappedInQuotes: /^["']/.test(key.trim()),
    },
  });
}

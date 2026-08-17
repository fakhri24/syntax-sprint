export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEMPORARY — delete once the production 500 is diagnosed.
 *
 * Every dynamic route on production returns 500 with an empty body while this
 * one answers 200, and the identical build behaves correctly under `next start`
 * on both Node 22 and Node 24. The only thing separating this route from the
 * dead ones is what they import, so the probe below walks the firebase-admin
 * graph one step at a time and reports which step throws.
 *
 * Everything is a dynamic import inside a try/catch, which keeps this module
 * itself import-free: the route cannot be taken down by the thing it measures.
 *
 * Reports presence, shape and error text only. No secret value is ever read
 * into the response.
 */

const REQUIRED = [
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "RUN_TOKEN_SECRET",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
] as const;

type StepResult = "ok" | { message: string; code: string | null; at: string[] };

function describe(error: unknown): StepResult {
  const e = error as { message?: string; code?: string | number; stack?: string };
  return {
    message: (e?.message ?? String(error)).slice(0, 400),
    code: e?.code != null ? String(e.code) : null,
    // Frames only — enough to name the module that failed, short enough to read.
    at: (e?.stack ?? "").split("\n").slice(1, 5).map((line) => line.trim()),
  };
}

export async function GET() {
  const key = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
  const steps: Record<string, StepResult> = {};

  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      await run();
      steps[name] = "ok";
    } catch (error) {
      steps[name] = describe(error);
    }
  };

  await step("import firebase-admin/app", async () => {
    await import("firebase-admin/app");
  });

  await step("import firebase-admin/firestore", async () => {
    await import("firebase-admin/firestore");
  });

  await step("initializeApp with cert", async () => {
    const { cert, getApps, initializeApp } = await import("firebase-admin/app");
    if (getApps().length) return;
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID!,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
        privateKey: key.replace(/\\n/g, "\n"),
      }),
    });
  });

  await step("firestore read", async () => {
    const { getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    await getFirestore(getApps()[0]).collection("snippets").doc("rocket-launch").get();
  });

  return Response.json({
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    envPresent: Object.fromEntries(REQUIRED.map((name) => [name, Boolean(process.env[name])])),
    privateKeyShape: {
      length: key.length,
      headerExact: key.trimStart().startsWith("-----BEGIN PRIVATE KEY-----"),
      footerExact: key.trimEnd().endsWith("-----END PRIVATE KEY-----"),
      hasRealNewlines: key.includes("\n"),
      hasEscapedNewlines: key.includes("\\n"),
      wrappedInQuotes: /^["']/.test(key.trim()),
    },
    steps,
  });
}

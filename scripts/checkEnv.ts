/**
 * Validates the environment described in AGENTS.md §4.14 without ever printing a
 * secret value. Run with `npm run check:env`; add `--offline` to skip the network
 * round-trips (useful in CI where credentials are absent).
 *
 * Values come from process.env, loaded by Node's --env-file, so this checks the
 * variables exactly as Next.js would see them.
 */
import crypto from "node:crypto";

const CLIENT_VARS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

const SERVER_VARS = [
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "RUN_TOKEN_SECRET",
] as const;

type Status = "PASS" | "WARN" | "FAIL";
const results: Array<{ status: Status; name: string; detail: string }> = [];
const pass = (name: string, detail = "") => results.push({ status: "PASS", name, detail });
const warn = (name: string, detail: string) => results.push({ status: "WARN", name, detail });
const fail = (name: string, detail: string) => results.push({ status: "FAIL", name, detail });

const env = (name: string) => process.env[name]?.trim() ?? "";

function checkPresence() {
  for (const name of [...CLIENT_VARS, ...SERVER_VARS]) {
    if (!env(name)) fail(name, "missing or empty");
  }
  // A server secret must never be reachable from the browser bundle.
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("NEXT_PUBLIC_") && /PRIVATE_KEY|SECRET|CLIENT_EMAIL/.test(name)) {
      fail(name, "server secret exposed via NEXT_PUBLIC_ prefix");
    }
  }
}

function checkClientConfig() {
  const projectId = env("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  const adminProjectId = env("FIREBASE_ADMIN_PROJECT_ID");
  const senderId = env("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID");

  if (projectId && adminProjectId) {
    if (projectId === adminProjectId) pass("project id match", `both target "${projectId}"`);
    else fail("project id match", `client="${projectId}" but admin="${adminProjectId}"`);
  }

  const apiKey = env("NEXT_PUBLIC_FIREBASE_API_KEY");
  if (apiKey) {
    if (/^AIza[0-9A-Za-z_-]{35}$/.test(apiKey)) pass("api key format");
    else warn("api key format", "does not look like a Firebase web API key");
  }

  const authDomain = env("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  if (authDomain && projectId) {
    if (authDomain === `${projectId}.firebaseapp.com`) pass("auth domain");
    else warn("auth domain", `expected "${projectId}.firebaseapp.com", got "${authDomain}"`);
  }

  const bucket = env("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
  if (bucket && projectId) {
    if (bucket === `${projectId}.appspot.com` || bucket === `${projectId}.firebasestorage.app`) {
      pass("storage bucket");
    } else {
      warn("storage bucket", `unexpected bucket for project "${projectId}"`);
    }
  }

  if (senderId) {
    if (/^\d{6,}$/.test(senderId)) pass("sender id format");
    else warn("sender id format", "expected digits only");
  }

  const appId = env("NEXT_PUBLIC_FIREBASE_APP_ID");
  if (appId) {
    const match = /^1:(\d+):web:[0-9a-f]+$/.exec(appId);
    if (!match) warn("app id format", "expected 1:<senderId>:web:<hex>");
    else if (senderId && match[1] !== senderId) fail("app id / sender id", "appId embeds a different sender id");
    else pass("app id format");
  }
}

function checkServerSecrets() {
  const projectId = env("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  const email = env("FIREBASE_ADMIN_CLIENT_EMAIL");
  if (email) {
    if (!/^[^@]+@[^@]+\.iam\.gserviceaccount\.com$/.test(email)) {
      fail("client email", "not a service-account address");
    } else if (projectId && !email.endsWith(`@${projectId}.iam.gserviceaccount.com`)) {
      warn("client email", "service account belongs to a different project");
    } else {
      pass("client email", email.startsWith("firebase-adminsdk") ? "firebase-adminsdk account" : "custom account");
    }
  }

  const rawKey = env("FIREBASE_ADMIN_PRIVATE_KEY");
  if (rawKey) {
    const pem = rawKey.replace(/\\n/g, "\n");
    if (!pem.includes("-----BEGIN PRIVATE KEY-----")) fail("private key", "missing PEM header — truncated?");
    else if (!pem.trimEnd().endsWith("-----END PRIVATE KEY-----")) fail("private key", "missing PEM footer — truncated?");
    else if (!pem.includes("\n")) fail("private key", "no newlines after unescaping — check quoting");
    else {
      try {
        const key = crypto.createPrivateKey(pem);
        pass("private key", `${key.asymmetricKeyType?.toUpperCase()} ${key.asymmetricKeyDetails?.modulusLength ?? "?"}-bit`);
      } catch (error) {
        fail("private key", `unparseable: ${(error as Error).message}`);
      }
    }
  }

  const secret = env("RUN_TOKEN_SECRET");
  if (secret) {
    const bytes = Buffer.from(secret, "base64url").length;
    if (secret.length < 32) fail("run token secret", `only ${secret.length} chars — too weak for HMAC-SHA256`);
    else if (/^(changeme|placeholder|secret|test)/i.test(secret)) fail("run token secret", "looks like a placeholder");
    else if (bytes < 32) warn("run token secret", `decodes to ${bytes} bytes; 32+ recommended`);
    else pass("run token secret", `${bytes} bytes of entropy`);
  }
}

/**
 * Proves the credentials actually work. The Admin SDK is imported dynamically so
 * `--offline` never pays for it, and so a missing key fails the structural check
 * with a clear message rather than an SDK stack trace.
 */
async function checkLive() {
  const { cert, initializeApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");

  const app = initializeApp({
    credential: cert({
      projectId: env("FIREBASE_ADMIN_PROJECT_ID"),
      clientEmail: env("FIREBASE_ADMIN_CLIENT_EMAIL"),
      privateKey: env("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n"),
    }),
  });

  // Signs locally: proves the key itself is usable.
  try {
    await getAuth(app).createCustomToken("healthcheck");
    pass("custom token signing", "private key can sign");
  } catch (error) {
    fail("custom token signing", (error as Error).message.split("\n")[0]);
  }

  // Real round-trip: proves Firestore IAM and that a database exists.
  try {
    const collections = await getFirestore(app).listCollections();
    pass(
      "firestore reachable",
      collections.length ? `${collections.length} collection(s)` : "connected, database empty",
    );
  } catch (error) {
    const err = error as { code?: number | string; message: string };
    fail(
      "firestore reachable",
      err.code === 5 || String(err.code) === "5"
        ? "NOT_FOUND — no Firestore database in this project yet (Console → Build → Firestore Database)"
        : err.message.split("\n")[0],
    );
  }

  // Proves the Identity Toolkit API is enabled.
  try {
    const { users } = await getAuth(app).listUsers(1);
    pass("auth reachable", `${users.length} user(s) so far`);
  } catch (error) {
    const err = error as { code?: string; message: string };
    fail(
      "auth reachable",
      err.code === "auth/configuration-not-found"
        ? "Authentication not set up yet (Console → Build → Authentication → Get started)"
        : err.message.split("\n")[0],
    );
  }
}

async function main() {
  const offline = process.argv.includes("--offline");

  checkPresence();
  checkClientConfig();
  checkServerSecrets();

  const structurallyBroken = results.some((r) => r.status === "FAIL");
  if (offline) {
    warn("live checks", "skipped (--offline)");
  } else if (structurallyBroken) {
    warn("live checks", "skipped — fix the failures above first");
  } else {
    await checkLive();
  }

  const width = Math.max(...results.map((r) => r.name.length));
  const icon: Record<Status, string> = { PASS: "✓", WARN: "!", FAIL: "✗" };
  for (const { status, name, detail } of results) {
    console.log(`${icon[status]} ${name.padEnd(width)}  ${detail}`);
  }

  const failures = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n${failures === 0 ? "environment OK" : `${failures} problem(s) found`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

/**
 * Firebase Admin initialization, shared by route handlers and by the seed
 * script (AGENTS.md §4.10, §4.14).
 *
 * Deliberately does NOT `import "server-only"`. That guard belongs on the
 * app-facing wrapper (`src/lib/firebaseAdmin.ts`), but it throws outside a
 * React Server Component context — which would make this unusable from a plain
 * Node script. The ESLint boundary in eslint.config.mjs keeps `@/server/*` out
 * of client and engine code instead.
 */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required server env var: ${name}`);
  return value;
}

export function getAdminApp(): App {
  const existing = getApps();
  if (existing.length) return existing[0];

  return initializeApp({
    credential: cert({
      projectId: requireEnv("FIREBASE_ADMIN_PROJECT_ID"),
      clientEmail: requireEnv("FIREBASE_ADMIN_CLIENT_EMAIL"),
      // Vercel/Netlify store the key with literal \n sequences.
      privateKey: requireEnv("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n"),
    }),
  });
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

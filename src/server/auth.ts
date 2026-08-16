/**
 * Request authentication for the run endpoints (AGENTS.md §4.6).
 *
 * The uid always comes from a verified Firebase ID token, never from the
 * request body. A body-supplied uid would let anyone submit runs as anyone.
 */
import { getAdminAuth } from "./adminApp";

export interface RequestIdentity {
  uid: string;
  displayName: string;
  photoURL: string;
}

export type IdentityResult =
  | { ok: true; identity: RequestIdentity }
  | { ok: false; reason: string };

export async function identifyRequest(request: Request): Promise<IdentityResult> {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return { ok: false, reason: "missing bearer token" };
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return {
      ok: true,
      identity: {
        uid: decoded.uid,
        // Denormalized onto leaderboard entries so reads never fan out (§4.7).
        displayName: (decoded.name as string | undefined) ?? "Anonymous",
        photoURL: (decoded.picture as string | undefined) ?? "",
      },
    };
  } catch {
    // Never echo the verification error: it distinguishes expired from forged.
    return { ok: false, reason: "invalid or expired session" };
  }
}

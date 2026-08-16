import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { identifyRequest } from "@/server/auth";
import { createRunTokenPayload, recordIssuedToken, signRunToken } from "@/server/runToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issues the single-use token a run needs to be submittable (AGENTS.md §4.13).
 *
 * Requiring this *before* typing is what makes guest runs unsubmittable after
 * the fact, and it gives the server the only wall-clock evidence it will ever
 * have about when the run began (§4.6).
 */
export async function POST(request: Request) {
  const identified = await identifyRequest(request);
  if (!identified.ok) {
    return NextResponse.json({ error: identified.reason }, { status: 401 });
  }

  let body: { snippetId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const snippetId = body?.snippetId;
  if (typeof snippetId !== "string" || snippetId.length === 0) {
    return NextResponse.json({ error: "snippetId is required" }, { status: 400 });
  }

  const db = getAdminDb();

  // Confirm the level exists before minting a token for it, so a typo fails
  // here rather than at submission, after the player has typed the whole thing.
  const snapshot = await db.collection("snippets").doc(snippetId).get();
  if (!snapshot.exists) {
    return NextResponse.json({ error: "unknown snippet" }, { status: 404 });
  }

  const secret = process.env.RUN_TOKEN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "server is not configured for scoring" }, { status: 500 });
  }

  const payload = createRunTokenPayload(identified.identity.uid, snippetId, Date.now());
  await recordIssuedToken(db, payload);

  return NextResponse.json({
    runToken: signRunToken(payload, secret),
    expiresAt: payload.expiresAt,
  });
}

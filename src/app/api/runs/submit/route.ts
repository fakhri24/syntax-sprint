import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { identifyRequest } from "@/server/auth";
import { assertRedeemable, markRedeemed, verifyRunToken } from "@/server/runToken";
import {
  applyUpdates,
  decideUpdates,
  readEntries,
  type LeaderboardUpdate,
} from "@/server/leaderboard";
import { verifyRun } from "@/server/verifyRun";
import type { RunRecord, RunSubmission, Snippet } from "@/types/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only writer for the `runs` collection (AGENTS.md §4.6, §4.10).
 *
 * Nothing the client sends about its own performance is trusted. The body
 * carries raw telemetry; every score is recomputed here, and the run and its
 * token redemption are written in one transaction so a token can never be spent
 * twice even under concurrent submissions.
 */
export async function POST(request: Request) {
  const identified = await identifyRequest(request);
  if (!identified.ok) {
    return NextResponse.json({ error: identified.reason }, { status: 401 });
  }

  let submission: RunSubmission;
  try {
    submission = (await request.json()) as RunSubmission;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const secret = process.env.RUN_TOKEN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "server is not configured for scoring" }, { status: 500 });
  }

  // Cheap, stateless rejection before any database access.
  const token = verifyRunToken(submission?.runToken ?? "", secret, Date.now());
  if (!token.ok) {
    return NextResponse.json({ error: token.reason }, { status: 400 });
  }

  // A valid signature proves the token is ours, not that it is this caller's.
  if (token.payload.uid !== identified.identity.uid) {
    return NextResponse.json({ error: "run token belongs to another user" }, { status: 403 });
  }

  const db = getAdminDb();
  const snapshot = await db.collection("snippets").doc(token.payload.snippetId).get();
  if (!snapshot.exists) {
    return NextResponse.json({ error: "unknown snippet" }, { status: 404 });
  }
  const snippet = snapshot.data() as Snippet;

  const verified = verifyRun({ submission, snippet, token: token.payload, now: Date.now() });
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: 422 });
  }

  const runRef = db.collection("runs").doc();
  const record: RunRecord = {
    id: runRef.id,
    userId: identified.identity.uid,
    snippetId: snippet.id,
    grossWpm: verified.metrics.grossWpm,
    netWpm: verified.metrics.netWpm,
    accuracy: verified.metrics.accuracy,
    elapsedMs: verified.metrics.elapsedMs,
    totalErrors: submission.errorOffsets.length,
    verified: verified.flags.length === 0,
    flags: verified.flags,
    // Server clock: a client's own timestamp is not evidence of anything.
    createdAt: Date.now(),
  };

  let update: LeaderboardUpdate = { snippet: null, global: null };

  try {
    await db.runTransaction(async (tx) => {
      // Firestore requires every read before any write, so both reads happen
      // first and the validation that can abort runs against them.
      const tokenRef = await assertRedeemable(tx, db, token.payload);
      const existing = await readEntries(tx, db, snippet.id, identified.identity.uid);

      update = decideUpdates(record, identified.identity, existing);

      markRedeemed(tx, tokenRef);
      tx.set(runRef, record);
      applyUpdates(tx, db, identified.identity.uid, snippet.id, update);
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }

  return NextResponse.json({
    runId: record.id,
    verified: record.verified,
    flags: record.flags,
    grossWpm: record.grossWpm,
    netWpm: record.netWpm,
    accuracy: record.accuracy,
    elapsedMs: record.elapsedMs,
    // Lets the completion screen say "new personal best" without another read.
    personalBest: { snippet: update.snippet !== null, global: update.global !== null },
  });
}

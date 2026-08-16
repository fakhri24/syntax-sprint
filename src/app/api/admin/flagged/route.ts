import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { identifyRequest } from "@/server/auth";
import { isAdmin } from "@/server/admin";
import { RUNS } from "@/lib/collections";
import { applyUpdates, decideUpdates, readEntries } from "@/server/leaderboard";
import type { RunRecord } from "@/types/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLAGGED_PAGE_SIZE = 100;

async function requireAdmin(request: Request) {
  const identified = await identifyRequest(request);
  if (!identified.ok) return { error: NextResponse.json({ error: identified.reason }, { status: 401 }) };
  if (!isAdmin(identified.identity.uid)) {
    // Same shape as a missing route: an admin surface should not confirm it exists.
    return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  return { identity: identified.identity };
}

/** Runs the heuristics held back for review (PLAN 4.1). */
export async function GET(request: Request) {
  const gate = await requireAdmin(request);
  if (gate.error) return gate.error;

  const snapshot = await getAdminDb()
    .collection(RUNS)
    .where("verified", "==", false)
    .orderBy("createdAt", "desc")
    .limit(FLAGGED_PAGE_SIZE)
    .get();

  return NextResponse.json({
    runs: snapshot.docs.map((doc) => doc.data() as RunRecord),
  });
}

/**
 * Promotes a false positive: clears the flags and lets the run compete for the
 * leaderboard as if it had never been held.
 *
 * The aggregate update runs through the same `decideUpdates` the submit handler
 * uses, so a promoted run still only takes a slot if it genuinely beats the
 * player's stored best.
 */
export async function POST(request: Request) {
  const gate = await requireAdmin(request);
  if (gate.error) return gate.error;

  let body: { runId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const runId = body?.runId;
  if (typeof runId !== "string" || !runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  const db = getAdminDb();
  const runRef = db.collection(RUNS).doc(runId);

  try {
    const promoted = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(runRef);
      if (!snapshot.exists) throw new Error("unknown run");

      const run = { ...(snapshot.data() as RunRecord), verified: true, flags: [] };

      // Reads before writes, as everywhere else in this codebase.
      const existing = await readEntries(tx, db, run.snippetId, run.userId);

      // The player's name at the time of the run is not recoverable here, so
      // reuse whatever the aggregate already shows rather than inventing one.
      const identity = {
        uid: run.userId,
        displayName: existing.snippet?.displayName ?? existing.global?.displayName ?? "Player",
        photoURL: existing.snippet?.photoURL ?? existing.global?.photoURL ?? "",
      };
      const update = decideUpdates(run, identity, existing);

      tx.update(runRef, { verified: true, flags: [] });
      applyUpdates(tx, db, run.userId, run.snippetId, update);

      return { runId, enteredLeaderboard: update.snippet !== null || update.global !== null };
    });

    return NextResponse.json(promoted);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}

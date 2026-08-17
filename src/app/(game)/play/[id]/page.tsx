import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import KeyboardGate from "@/components/gates/KeyboardGate";
import Arena from "@/components/arena/Arena";
import ArenaUnavailable from "@/components/arena/ArenaUnavailable";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { SNIPPETS } from "@/lib/collections";
import type { Snippet } from "@/types/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The arena route.
 *
 * The snippet is read server-side so the editor has its text and precomputed
 * tokens in the first paint — a typing game that shows an empty box while it
 * fetches has already lost the player's first second.
 */
interface PlayPageProps {
  params: Promise<{ id: string }>;
}

export default async function PlayPage({ params }: PlayPageProps) {
  const { id } = await params;

  let snapshot: DocumentSnapshot;
  try {
    snapshot = await getAdminDb().collection(SNIPPETS).doc(id).get();
  } catch (error) {
    /**
     * Handled here rather than left to `error.tsx`, because on Vercel it would
     * never reach it. Next runs in minimal mode there, where a throw raised
     * before the shell has flushed is re-thrown past every boundary and
     * answered with the platform's prebuilt /500 — see base-server.js:
     * `if (this.minimalMode && res.statusCode === 500) throw err`. Reading the
     * snippet is the first thing this component does, so it is always that
     * case.
     *
     * The cost is an HTTP 200 on a server failure, which makes the line below
     * the only signal monitoring gets. It carries the reference shown on screen
     * so a player's report maps to one log entry.
     */
    const reference = randomUUID().slice(0, 8);
    console.error(`[play/${id}] snippet read failed (ref ${reference})`, error);
    return <ArenaUnavailable reference={reference} retryHref={`/play/${id}`} />;
  }

  // Deliberately outside the catch: notFound() signals by throwing, and
  // swallowing it would turn a missing level into a server failure.
  if (!snapshot.exists) notFound();

  const snippet = snapshot.data() as Snippet;

  return (
    <KeyboardGate>
      <Arena snippet={snippet} />
    </KeyboardGate>
  );
}

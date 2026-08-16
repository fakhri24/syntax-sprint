import { notFound } from "next/navigation";
import KeyboardGate from "@/components/gates/KeyboardGate";
import Arena from "@/components/arena/Arena";
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

  const snapshot = await getAdminDb().collection(SNIPPETS).doc(id).get();
  if (!snapshot.exists) notFound();

  const snippet = snapshot.data() as Snippet;

  return (
    <KeyboardGate>
      <Arena snippet={snippet} />
    </KeyboardGate>
  );
}

import type { SnippetManifest } from "@/types/schema";
import rocketLaunch from "./01-rocket-launch";
import digitalBadge from "./02-digital-badge";
import interactiveCard from "./03-interactive-card";

/** The single source of truth for playable levels (AGENTS.md invariant #4). */
export const SNIPPET_MANIFESTS: SnippetManifest[] = [rocketLaunch, digitalBadge, interactiveCard];

export type { SnippetManifest };

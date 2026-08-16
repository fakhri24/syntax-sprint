import type { SnippetManifest } from "@/types/schema";

/**
 * Level 2 — SVG. The circle lands first and the checkmark draws on top, so the
 * badge assembles in two visible stages as the player types.
 */
const snippet: SnippetManifest = {
  id: "digital-badge",
  title: "Digital Badge",
  difficulty: "medium",
  language: "svg",
  targetCode: `<circle cx="32" cy="32" r="27" fill="#0f172a" stroke="#38bdf8" stroke-width="3" />
<path
  d="M21 33l8 8 15-16"
  fill="none"
  stroke="#38bdf8"
  stroke-width="5"
  stroke-linecap="round"
  stroke-linejoin="round"
/>`,
  initialStageHTML: `<style>
  svg { display: block; margin: 0 auto; background: #020617; border-radius: 12px; }
</style>
<svg viewBox="0 0 64 64" width="220" height="220"></svg>`,
  authorUid: "curated",
};

export default snippet;

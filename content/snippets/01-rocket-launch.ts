import type { SnippetManifest } from "@/types/schema";

/**
 * Level 1 — CSS. Every declaration moves the rocket a little further, so the
 * stage rewards the player mid-line rather than only at the closing brace.
 */
const snippet: SnippetManifest = {
  id: "rocket-launch",
  title: "Rocket Launch",
  difficulty: "easy",
  language: "css",
  targetCode: `.rocket {
  transform: translateY(-120px) rotate(6deg);
  opacity: 1;
  filter: drop-shadow(0 12px 24px rgba(255, 138, 0, 0.55));
}`,
  initialStageHTML: `<style>
  .sky {
    display: grid;
    place-items: center;
    height: 240px;
    background: linear-gradient(180deg, #0b1020, #1b2a4a);
    border-radius: 12px;
    overflow: hidden;
  }
  .rocket {
    font-size: 56px;
    opacity: 0.2;
    transition: transform 700ms ease-out, opacity 500ms linear, filter 500ms linear;
  }
</style>
<div class="sky"><div class="rocket">🚀</div></div>`,
  authorUid: "curated",
};

export default snippet;

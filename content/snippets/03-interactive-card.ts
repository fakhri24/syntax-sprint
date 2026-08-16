import type { SnippetManifest } from "@/types/schema";

/**
 * Level 3 — JavaScript. Four top-level statements, so the checkpoint index has
 * four entries and the stage updates four times across the run (§4.4). The
 * trailing `card.click()` is what makes the last checkpoint visibly pay off:
 * without it the listener would be attached but never fire.
 */
const snippet: SnippetManifest = {
  id: "interactive-card",
  title: "Interactive Card",
  difficulty: "hard",
  language: "javascript",
  targetCode: `const card = document.querySelector(".card");
const label = card.querySelector(".label");

card.addEventListener("click", () => {
  card.classList.toggle("is-open");
  label.textContent = card.classList.contains("is-open") ? "open" : "closed";
});

card.click();`,
  initialStageHTML: `<style>
  body { margin: 0; font-family: ui-monospace, monospace; }
  .card {
    width: 200px;
    margin: 24px auto;
    padding: 20px;
    border-radius: 12px;
    background: #1e293b;
    color: #e2e8f0;
    cursor: pointer;
    transition: transform 250ms ease, background 250ms ease;
  }
  .card.is-open {
    background: #0ea5e9;
    transform: translateY(-6px) scale(1.03);
  }
</style>
<div class="card">card <span class="label">closed</span></div>`,
  authorUid: "curated",
};

export default snippet;

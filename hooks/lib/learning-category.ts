/**
 * Learning categorization: SYSTEM (tooling/infra) vs ALGORITHM (approach/design).
 * Used by both learning.ts and work-learning.ts handlers.
 */

export type LearningCategory = "system" | "algorithm";

const SYSTEM_KEYWORDS =
  /\b(config|setting|install|deploy|build|lint|format|biome|typescript|tsc|hook|plugin|ci|cd|pipeline|docker|package|dependency|migration|schema|database|env|permission|security|git|commit|branch|merge)\b/i;

/** Classify a learning based on title and summary content */
export function categorizeLearning(...texts: string[]): LearningCategory {
  return SYSTEM_KEYWORDS.test(texts.join(" ")) ? "system" : "algorithm";
}

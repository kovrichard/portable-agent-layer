/**
 * Shared prompt fragments — single source of truth for inference instructions.
 */

/** Principle extraction instruction for failed interactions. */
export const FAILURE_PRINCIPLE_PROMPT =
  "Write one actionable sentence that would prevent this issue from happening again. If no clear lesson, leave principle empty. Be concise.";

/** Principle extraction instruction for session learnings. */
export const LEARNING_PRINCIPLE_PROMPT =
  "If this session taught a reusable lesson, write one actionable sentence that would prevent the same issue in the future. If no clear lesson, leave empty. Be concise.";

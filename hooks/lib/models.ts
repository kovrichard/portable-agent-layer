/**
 * Single source of truth for model IDs and pricing.
 */

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/** Pricing per million tokens (USD) — from https://platform.claude.com/docs/en/about-claude/pricing */
export const MODEL_PRICING: Record<
  string,
  { input: number; output: number; cacheWrite: number; cacheRead: number }
> = {
  [HAIKU_MODEL]: { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-opus-4-6": { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
};

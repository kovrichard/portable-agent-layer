/**
 * Single source of truth for model IDs and pricing.
 */

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/** Pricing per million tokens (USD) */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  [HAIKU_MODEL]: { input: 1.0, output: 5.0 },
};

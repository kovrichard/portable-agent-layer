/**
 * Single source of truth for model IDs and pricing.
 */

import type { AgentType } from "./agent";

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export const SONNET_MODEL = "claude-sonnet-4-6";
export const FABLE_MODEL = "claude-fable-5";

/**
 * Per-agent flagship model used to AUTHOR new skills (via `create-skill`).
 *
 * This is the single extension point for delegated skill authoring: an agent
 * present here → `create-skill` spins up that agent's `skill-author` subagent on
 * this model; an agent absent → `create-skill` authors inline. Add a provider by
 * adding one entry (and a matching platform block in assets/agents/skill-author.md).
 */
export const FLAGSHIP_AUTHOR_MODEL: Partial<Record<AgentType, string>> = {
  claude: FABLE_MODEL,
  // codex: "gpt-5.5",   // enable once Codex ships a tool-capable flagship subagent
};

/** Flagship authoring model for an agent, or undefined if none is configured. */
export function flagshipAuthorModel(agent: AgentType): string | undefined {
  return FLAGSHIP_AUTHOR_MODEL[agent];
}

export interface ModelPricing {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

/** Pricing per million tokens (USD) — from https://platform.claude.com/docs/en/about-claude/pricing */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  [HAIKU_MODEL]: {
    input: 1,
    output: 5,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2,
    cacheRead: 0.1,
  },
  [FABLE_MODEL]: {
    input: 10,
    output: 50,
    cacheWrite5m: 12.5,
    cacheWrite1h: 20,
    cacheRead: 1,
  },
  "claude-opus-5": {
    input: 5,
    output: 25,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
    cacheRead: 0.5,
  },
  "claude-opus-4-8": {
    input: 5,
    output: 25,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
    cacheRead: 0.5,
  },
  "claude-opus-4-7": {
    input: 5,
    output: 25,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
    cacheRead: 0.5,
  },
  "claude-opus-4-6": {
    input: 5,
    output: 25,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
    cacheRead: 0.5,
  },
  "claude-opus-4-5": {
    input: 5,
    output: 25,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
    cacheRead: 0.5,
  },
  // Claude Sonnet 5 — introductory pricing through 2026-08-31; standard (3/15/3.75/6/0.30) applies from 2026-09-01.
  "claude-sonnet-5": {
    input: 2,
    output: 10,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4,
    cacheRead: 0.2,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6,
    cacheRead: 0.3,
  },
  "claude-sonnet-4-5": {
    input: 3,
    output: 15,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6,
    cacheRead: 0.3,
  },
};

function longestPrefixKey(model: string): string | null {
  let best: string | null = null;
  for (const key of Object.keys(MODEL_PRICING)) {
    if (model.startsWith(key) && (best === null || key.length > best.length)) best = key;
  }
  return best;
}

/**
 * Rates for a model ID. Transcripts carry variants of the same model — dated
 * (`claude-opus-5-20260115`) and context-tagged (`claude-opus-5[1m]`) — so an
 * exact miss falls back to the longest table key the ID starts with.
 */
export function pricingFor(model: string): ModelPricing | null {
  const exact = MODEL_PRICING[model];
  if (exact) return exact;
  const prefix = longestPrefixKey(model);
  return prefix ? MODEL_PRICING[prefix] : null;
}

/** USD cost of a token usage record. Unpriced models bill as 0. */
export function costOfUsage(model: string, usage: TokenUsage): number {
  const p = pricingFor(model);
  if (!p) return 0;
  return (
    (usage.input * p.input +
      usage.output * p.output +
      usage.cacheWrite5m * p.cacheWrite5m +
      usage.cacheWrite1h * p.cacheWrite1h +
      usage.cacheRead * p.cacheRead) /
    1_000_000
  );
}

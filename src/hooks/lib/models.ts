/**
 * Single source of truth for model IDs and pricing.
 */

import type { AgentType } from "./agent";

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export const SONNET_MODEL = "claude-sonnet-5";
export const FABLE_MODEL = "claude-fable-5";

export type InferenceTier = "small" | "medium";

export type FixedModelRoute =
  | "claude-spawn"
  | "anthropic-api"
  | "codex-spawn"
  | "openai-api";

/** `large` is the flagship that authors skills and subagents; without one, the agent authors inline. */
type RouteModels = Record<InferenceTier, string> & { large?: string };

const ANTHROPIC_MODELS: RouteModels = {
  small: HAIKU_MODEL,
  medium: SONNET_MODEL,
  large: FABLE_MODEL,
};
const OPENAI_MODELS: RouteModels = {
  small: "gpt-6-luna",
  medium: "gpt-6-sol",
  large: "gpt-6-astra",
};

/**
 * opencode's models come from the user's own config (opencodeTierModel). Copilot and
 * Cursor are absent on purpose: which named models they accept depends on the user's
 * plan, and a free plan refuses every one but Auto.
 */
const INFERENCE_MODELS: Record<FixedModelRoute, RouteModels> = {
  "claude-spawn": ANTHROPIC_MODELS,
  "anthropic-api": ANTHROPIC_MODELS,
  "codex-spawn": OPENAI_MODELS,
  "openai-api": OPENAI_MODELS,
};

export function isFixedModelRoute(route: string): route is FixedModelRoute {
  return Object.hasOwn(INFERENCE_MODELS, route);
}

export function inferenceModel(
  route: FixedModelRoute,
  tier: InferenceTier = "small"
): string {
  return INFERENCE_MODELS[route][tier];
}

const AGENT_SPAWN_ROUTE: Partial<Record<AgentType, FixedModelRoute>> = {
  claude: "claude-spawn",
  codex: "codex-spawn",
};

/**
 * The model an agent's `skill-author` / `subagent-author` runs on, or undefined
 * when `create-skill` and `create-subagent` should author inline. A new provider
 * needs a `large` model on its route and a platform block in assets/agents/*-author.md.
 */
export function flagshipAuthorModel(agent: AgentType): string | undefined {
  const route = AGENT_SPAWN_ROUTE[agent];
  return route ? INFERENCE_MODELS[route].large : undefined;
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

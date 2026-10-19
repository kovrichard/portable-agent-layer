/**
 * Single source of truth for model IDs and pricing.
 */

import type { AgentType } from "./agent";

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export const HAIKU_5_5_MODEL = "claude-haiku-5-5";
export const SONNET_MODEL = "claude-sonnet-5-5";
export const FABLE_MODEL = "claude-fable-5-1";

export const INFERENCE_TIERS = ["small", "medium"] as const;
export type InferenceTier = (typeof INFERENCE_TIERS)[number];

export type FixedModelRoute =
  | "claude-spawn"
  | "anthropic-api"
  | "codex-spawn"
  | "openai-api"
  | "antigravity-spawn";

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
/** An Antigravity subagent's `model:` takes only a tier name, so `large` is `pro`. */
const GEMINI_MODELS: RouteModels = {
  small: "gemini-3.8-flash-low",
  medium: "gemini-3.8-flash-high",
  large: "pro",
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
  "antigravity-spawn": GEMINI_MODELS,
};

export function isFixedModelRoute(route: string): route is FixedModelRoute {
  return Object.hasOwn(INFERENCE_MODELS, route);
}

/**
 * Callers on Haiku 5.5: those whose prompt passed its eval there, and every new
 * caller, whose eval is iterated on 5.5 until it passes. The rest stay on
 * HAIKU_MODEL until theirs is evaluated.
 */
const ANTHROPIC_ON_HAIKU_5_5 = new Set(["rule-drafter", "correction-kind"]);

function evaluatedModel(models: RouteModels, caller?: string): string | undefined {
  const onAnthropic = models === ANTHROPIC_MODELS;
  return onAnthropic && caller && ANTHROPIC_ON_HAIKU_5_5.has(caller)
    ? HAIKU_5_5_MODEL
    : undefined;
}

export function inferenceModel(
  route: FixedModelRoute,
  tier: InferenceTier = "small",
  caller?: string
): string {
  const models = INFERENCE_MODELS[route];
  return evaluatedModel(models, caller) ?? models[tier];
}

const AGENT_SPAWN_ROUTE: Partial<Record<AgentType, FixedModelRoute>> = {
  claude: "claude-spawn",
  codex: "codex-spawn",
  antigravity: "antigravity-spawn",
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

interface SupersededRates {
  until: string;
  rates: ModelPricing;
}

/** A model's earlier rates, oldest first; a price change moves today's row here. */
export const PRICE_HISTORY: Record<string, SupersededRates[]> = {};

const withoutWritePremium = (
  input: number,
  cacheRead: number,
  output: number
): ModelPricing => ({
  input,
  output,
  cacheWrite5m: input,
  cacheWrite1h: input,
  cacheRead,
});

/**
 * Standard-tier rates from https://developers.openai.com/api/docs/pricing; prompts over
 * 272K tokens cost more, and PAL's never get there. OpenAI bills no cache-write premium.
 */
const OPENAI_PRICING: Record<string, ModelPricing> = {
  "gpt-6-astra": withoutWritePremium(10, 1, 50),
  "gpt-6.1-sol": withoutWritePremium(2, 0.1, 10),
  "gpt-6-sol": withoutWritePremium(2, 0.2, 10),
  "gpt-6-luna": withoutWritePremium(0.1, 0.01, 0.5),
  "gpt-5.6-sol": withoutWritePremium(4, 0.4, 20),
  "gpt-5.6-terra": withoutWritePremium(2, 0.2, 12),
  "gpt-5.6-luna": withoutWritePremium(0.2, 0.02, 1.2),
  "gpt-5.5": withoutWritePremium(5, 0.5, 30),
  "gpt-5.5-pro": withoutWritePremium(30, 30, 180),
  "gpt-5.4": withoutWritePremium(2.5, 0.25, 15),
  "gpt-5.4-pro": withoutWritePremium(30, 30, 180),
  "gpt-5.4-mini": withoutWritePremium(0.75, 0.075, 4.5),
  "gpt-5.4-nano": withoutWritePremium(0.2, 0.02, 1.25),
  "gpt-5.3-codex": withoutWritePremium(1.75, 0.175, 14),
};

/** Standard-tier serverless rates from https://docs.fireworks.ai/serverless/pricing */
const FIREWORKS_PRICING: Record<string, ModelPricing> = {
  "fireworks-ai/accounts/fireworks/models/kimi-k3": withoutWritePremium(3, 0.3, 15),
};

/** Pricing per million tokens (USD) in force today; Claude's from https://platform.claude.com/docs/en/about-claude/pricing */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  ...OPENAI_PRICING,
  ...FIREWORKS_PRICING,
  [HAIKU_MODEL]: {
    input: 1,
    output: 5,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2,
    cacheRead: 0.1,
  },
  // Rates for prompts up to 100k tokens; longer prompts cost 5x, and PAL's never get there.
  [HAIKU_5_5_MODEL]: {
    input: 0.1,
    output: 0.5,
    cacheWrite5m: 0.125,
    cacheWrite1h: 0.2,
    cacheRead: 0.01,
  },
  [FABLE_MODEL]: {
    input: 10,
    output: 50,
    cacheWrite5m: 12.5,
    cacheWrite1h: 20,
    cacheRead: 0.25,
  },
  "claude-fable-5": {
    input: 10,
    output: 50,
    cacheWrite5m: 12.5,
    cacheWrite1h: 20,
    cacheRead: 1,
  },
  "claude-opus-5-5": {
    input: 4,
    output: 20,
    cacheWrite5m: 5,
    cacheWrite1h: 8,
    cacheRead: 0.2,
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
  "claude-sonnet-5-5": {
    input: 2,
    output: 10,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4,
    cacheRead: 0.1,
  },
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
export function pricingFor(model: string, at?: string): ModelPricing | null {
  const key = MODEL_PRICING[model] ? model : longestPrefixKey(model);
  return key ? ratesInForce(key, at) : null;
}

function ratesInForce(key: string, at: string | undefined): ModelPricing {
  const when = Date.parse(at ?? "");
  const superseded = PRICE_HISTORY[key]?.find((s) => when < Date.parse(s.until));
  return superseded?.rates ?? MODEL_PRICING[key];
}

/** USD cost of a token usage record at the rates in force at `at`. Unpriced models bill as 0. */
export function costOfUsage(model: string, usage: TokenUsage, at?: string): number {
  const p = pricingFor(model, at);
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

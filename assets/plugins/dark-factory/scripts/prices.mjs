import { messageCacheWrites, onePerMessage } from "./lib.mjs";

/** @type {Record<string, { input: number, output: number, cacheWrite5m: number, cacheWrite1h: number, cacheRead: number }>} */
export const PRICES = {
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheWrite5m: 0.125,
    cacheWrite1h: 0.2,
    cacheRead: 0.01,
  },
  "claude-sonnet-5-5": {
    input: 2,
    output: 10,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4,
    cacheRead: 0.1,
  },
  "claude-opus-5-5": {
    input: 4,
    output: 20,
    cacheWrite5m: 5,
    cacheWrite1h: 8,
    cacheRead: 0.2,
  },
  "claude-fable-5-2": {
    input: 8,
    output: 40,
    cacheWrite5m: 10,
    cacheWrite1h: 16,
    cacheRead: 0.2,
  },
};

const LONG_PROMPT_TOKENS = 100000;
const LONG_PROMPT_MODELS = new Set(["claude-haiku-5-5"]);
const LONG_PROMPT_FACTOR = 5;

export function tokenCost(
  model,
  { input, output, cacheRead, cacheWrite5m, cacheWrite1h }
) {
  if (!Object.hasOwn(PRICES, model)) return null;
  const rates = PRICES[model];
  return (
    ((input ?? 0) * rates.input +
      (output ?? 0) * rates.output +
      (cacheRead ?? 0) * rates.cacheRead +
      (cacheWrite5m ?? 0) * rates.cacheWrite5m +
      (cacheWrite1h ?? 0) * rates.cacheWrite1h) /
    1e6
  );
}

export function messageCost({ model, usage }) {
  const u = usage ?? {};
  const split = messageCacheWrites(u);
  const base = tokenCost(model, {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens,
    cacheWrite5m: split.fiveMin,
    cacheWrite1h: split.oneHour,
  });
  if (base === null) return null;
  const prompt =
    (u.input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0);
  return LONG_PROMPT_MODELS.has(model) && prompt > LONG_PROMPT_TOKENS
    ? base * LONG_PROMPT_FACTOR
    : base;
}

export function transcriptCost(lines) {
  let total = 0;
  for (const line of onePerMessage(lines)) {
    const cost = messageCost(line.message);
    if (cost === null) return null;
    total += cost;
  }
  return total;
}

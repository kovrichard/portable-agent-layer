#!/usr/bin/env bun
/**
 * Perplexity Search — CLI tool for investigative search via the Perplexity Sonar API.
 *
 * Uses Perplexity's Sonar model with built-in web search to fetch
 * source-cited, verified information. Optimized for investigative queries
 * requiring cross-referenced, credible sources.
 *
 * Requires PAL_PERPLEXITY_API_KEY environment variable.
 *
 * Usage:
 *   bun perplexity-search.ts -- <query> [--max-tokens 4096]
 *   bun perplexity-search.ts -- "corruption allegations against company X"
 *   bun perplexity-search.ts -- "timeline of event Y with sources"
 */

import { parseArgs } from "node:util";

const API_BASE = "https://api.perplexity.ai";
const DEFAULT_MODEL = "sonar-pro";

interface Choice {
  message?: {
    role: string;
    content: string;
  };
}

interface PerplexityResponse {
  choices?: Choice[];
  citations?: string[];
  error?: { message: string; code?: number };
}

function loadApiKey(): string {
  const key = process.env.PAL_PERPLEXITY_API_KEY;
  if (!key) {
    console.error(
      "Error: PAL_PERPLEXITY_API_KEY environment variable is not set.\n" +
        "The Perplexity API could not be reached. The researcher agent should fall back to WebSearch.\n" +
        "To enable Perplexity search, get an API key at https://www.perplexity.ai/settings/api\n" +
        "and set it: export PAL_PERPLEXITY_API_KEY=pplx-..."
    );
    process.exit(1);
  }
  return key;
}

const SYSTEM_PROMPT = `You are an investigative research assistant. When searching, prioritize:
- Cross-referenced facts verified by 2+ independent sources
- Primary sources: court filings, official reports, government records, regulatory filings
- Credible journalism: established outlets with editorial standards
- Source credibility assessment: note publication reputation, potential bias, date of publication
- Evidence chains: connect claims to their original sources

Always include: source names, publication dates, and direct quotes when available.
Distinguish between confirmed facts, single-source claims, and unverified allegations.
Flag contradictions between sources.
Be thorough but concise.`;

export async function perplexitySearch(query: string, maxTokens: number): Promise<void> {
  const apiKey = loadApiKey();

  const body = {
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: query },
    ],
    max_tokens: maxTokens,
    return_citations: true,
    search_recency_filter: "week",
  };

  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    console.error(`Error: HTTP ${response.status} — ${err.slice(0, 500)}`);
    process.exit(1);
  }

  const data = (await response.json()) as PerplexityResponse;

  if (data.error) {
    console.error(`Error: ${data.error.message}`);
    process.exit(1);
  }

  if (!data.choices || data.choices.length === 0) {
    console.error("Error: No choices in Perplexity response.");
    process.exit(1);
  }

  const content = data.choices[0].message?.content;
  if (!content) {
    console.error("Error: No text content in Perplexity response.");
    process.exit(1);
  }

  console.log(content);

  // Extract citations
  if (data.citations && data.citations.length > 0) {
    console.log("\n---\n## Sources\n");
    for (let i = 0; i < data.citations.length; i++) {
      console.log(`- [${i + 1}] ${data.citations[i]}`);
    }
  }
}

async function run() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "max-tokens": { type: "string", short: "m", default: "4096" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(`Perplexity Search — investigative search via Perplexity Sonar API

Usage:
  bun perplexity-search.ts -- <query> [options]

Options:
  --max-tokens, -m <n>       Max response tokens (default: 4096)
  --help, -h                 Show this help

Examples:
  bun perplexity-search.ts -- "corruption allegations timeline"
  bun perplexity-search.ts -- "regulatory actions against company X"`);
    process.exit(0);
  }

  const query = positionals.join(" ");
  const maxTokens = Number.parseInt(values["max-tokens"] ?? "4096", 10);

  await perplexitySearch(query, maxTokens);
}

if (import.meta.main) run();

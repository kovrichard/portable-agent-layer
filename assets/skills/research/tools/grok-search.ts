#!/usr/bin/env bun
/**
 * Grok Search — CLI tool for real-time search via the Grok/X API.
 *
 * Uses the Grok Responses API with web_search and x_search tools
 * to fetch real-time information from the web and X (Twitter).
 *
 * Requires PAL_XAI_API_KEY environment variable.
 *
 * Usage:
 *   bun grok-search.ts -- <query> [--sources web,x] [--max-tokens 2048]
 *   bun grok-search.ts -- "latest AI news" --sources x
 *   bun grok-search.ts -- "bitcoin price today" --sources web
 */

import { parseArgs } from "node:util";

const API_BASE = "https://api.x.ai/v1";
const MODEL = "grok-4-1-fast-non-reasoning";

type SourceType = "web" | "x";
type ToolType = "web_search" | "x_search";

interface UrlCitation {
  type: "url_citation";
  url: string;
  title?: string;
}

interface ContentPart {
  type: string;
  text?: string;
  annotations?: UrlCitation[];
}

interface OutputItem {
  type: string;
  content?: ContentPart[];
  status?: string;
}

interface GrokResponse {
  output?: OutputItem[];
  error?: { message: string };
}

function loadApiKey(): string {
  const key = process.env.PAL_XAI_API_KEY;
  if (!key) {
    console.error("Error: PAL_XAI_API_KEY environment variable is not set.");
    console.error("Get an API key at https://console.x.ai/");
    process.exit(1);
  }
  return key;
}

function parseSources(raw: string): SourceType[] {
  const valid: SourceType[] = ["web", "x"];
  const parts = raw.split(",").map((s) => s.trim().toLowerCase());
  const sources = parts.filter((s): s is SourceType => valid.includes(s as SourceType));
  if (sources.length === 0) {
    console.error(`Error: Invalid sources "${raw}". Valid: web, x`);
    process.exit(1);
  }
  return sources;
}

function sourcesToTools(sources: SourceType[]): ToolType[] {
  const map: Record<SourceType, ToolType> = { web: "web_search", x: "x_search" };
  return sources.map((s) => map[s]);
}

export async function grokSearch(
  query: string,
  sources: SourceType[],
  maxTokens: number
): Promise<void> {
  const apiKey = loadApiKey();
  const tools = sourcesToTools(sources);

  const body = {
    model: MODEL,
    input: [
      {
        role: "system" as const,
        content:
          "You are a research assistant. Provide factual, sourced answers about current events and real-time information. Always include dates and source context. Be thorough but concise.",
      },
      { role: "user" as const, content: query },
    ],
    tools: tools.map((type) => ({ type })),
    max_output_tokens: maxTokens,
  };

  const response = await fetch(`${API_BASE}/responses`, {
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

  const data = (await response.json()) as GrokResponse;

  if (data.error) {
    console.error(`Error: ${data.error.message}`);
    process.exit(1);
  }

  if (!data.output || data.output.length === 0) {
    console.error("Error: No response output from Grok.");
    process.exit(1);
  }

  // Extract text and citations from message output items
  const textParts: string[] = [];
  const citations = new Map<string, string>(); // url → title

  for (const item of data.output) {
    if (item.type !== "message" || !item.content) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && part.text) {
        textParts.push(part.text);
      }
      if (part.annotations) {
        for (const ann of part.annotations) {
          if (ann.type === "url_citation" && ann.url) {
            citations.set(ann.url, ann.title ?? ann.url);
          }
        }
      }
    }
  }

  if (textParts.length === 0) {
    console.error("Error: No text content in Grok response.");
    process.exit(1);
  }

  console.log(textParts.join("\n\n"));

  if (citations.size > 0) {
    console.log("\n---\n## Sources\n");
    for (const [url, title] of citations) {
      console.log(`- [${title}](${url})`);
    }
  }
}

async function run() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      sources: { type: "string", short: "s", default: "web,x" },
      "max-tokens": { type: "string", short: "m", default: "2048" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(`Grok Search — real-time search via Grok/X API

Usage:
  bun grok-search.ts -- <query> [options]

Options:
  --sources, -s <web,x>      Comma-separated source types (default: web,x)
  --max-tokens, -m <n>       Max response tokens (default: 2048)
  --help, -h                 Show this help

Examples:
  bun grok-search.ts -- "latest AI news"
  bun grok-search.ts -- "bitcoin price" --sources web
  bun grok-search.ts -- "reactions to new iPhone" --sources x`);
    process.exit(0);
  }

  const query = positionals.join(" ");
  const sources = parseSources(values.sources ?? "web,x");
  const maxTokens = Number.parseInt(values["max-tokens"] ?? "2048", 10);

  await grokSearch(query, sources, maxTokens);
}

if (import.meta.main) run();

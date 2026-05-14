#!/usr/bin/env bun
/**
 * Gemini Search — CLI tool for grounded search via the Gemini API.
 *
 * Uses Gemini's built-in Google Search grounding to fetch real-time,
 * source-cited information. Optimized for academic and scholarly queries.
 *
 * Requires PAL_GEMINI_API_KEY environment variable.
 *
 * Usage:
 *   bun gemini-search.ts -- <query> [--max-tokens 4096]
 *   bun gemini-search.ts -- "recent advances in transformer architectures"
 *   bun gemini-search.ts -- "CRISPR gene editing clinical trials 2025"
 */

import { parseArgs } from "node:util";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.1-flash-lite-preview";

interface GroundingChunk {
  web?: { uri: string; title: string };
}

interface GroundingSupport {
  segment?: { startIndex: number; endIndex: number; text: string };
  groundingChunkIndices?: number[];
}

interface GroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: GroundingChunk[];
  groundingSupports?: GroundingSupport[];
  searchEntryPoint?: { renderedContent: string };
}

interface ContentPart {
  text?: string;
}

interface Candidate {
  content?: { parts?: ContentPart[]; role?: string };
  groundingMetadata?: GroundingMetadata;
}

interface GeminiResponse {
  candidates?: Candidate[];
  error?: { message: string; code: number };
}

function loadApiKey(): string {
  const key = process.env.PAL_GEMINI_API_KEY;
  if (!key) {
    console.error("Error: PAL_GEMINI_API_KEY environment variable is not set.");
    console.error("Get an API key at https://aistudio.google.com/apikey");
    process.exit(1);
  }
  return key;
}

const SYSTEM_PROMPT = `You are an academic research assistant. When searching, prioritize:
- Peer-reviewed papers, preprints (arXiv, bioRxiv, medRxiv)
- Official documentation and technical specifications
- University and research institution publications
- Conference proceedings (NeurIPS, ICML, ACL, CVPR, etc.)
- Systematic reviews and meta-analyses

Always include: author names, publication year, journal/venue when available.
Distinguish between peer-reviewed findings and preprints/working papers.
Note methodology limitations and sample sizes when relevant.
Be thorough but concise.`;

async function geminiSearch(query: string, maxTokens: number): Promise<void> {
  const apiKey = loadApiKey();

  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        parts: [{ text: query }],
      },
    ],
    tools: [{ google_search: {} }],
    generationConfig: {
      maxOutputTokens: maxTokens,
    },
  };

  const url = `${API_BASE}/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    console.error(`Error: HTTP ${response.status} — ${err.slice(0, 500)}`);
    process.exit(1);
  }

  const data = (await response.json()) as GeminiResponse;

  if (data.error) {
    console.error(`Error: ${data.error.message}`);
    process.exit(1);
  }

  if (!data.candidates || data.candidates.length === 0) {
    console.error("Error: No candidates in Gemini response.");
    process.exit(1);
  }

  const candidate = data.candidates[0];

  // Extract text
  const textParts: string[] = [];
  if (candidate.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.text) textParts.push(part.text);
    }
  }

  if (textParts.length === 0) {
    console.error("Error: No text content in Gemini response.");
    process.exit(1);
  }

  console.log(textParts.join("\n\n"));

  // Extract grounding metadata
  const meta = candidate.groundingMetadata;
  if (meta) {
    if (meta.webSearchQueries && meta.webSearchQueries.length > 0) {
      console.log("\n---\n## Search Queries Used\n");
      for (const q of meta.webSearchQueries) {
        console.log(`- ${q}`);
      }
    }

    if (meta.groundingChunks && meta.groundingChunks.length > 0) {
      console.log("\n---\n## Sources\n");
      for (const chunk of meta.groundingChunks) {
        if (chunk.web) {
          console.log(`- [${chunk.web.title}](${chunk.web.uri})`);
        }
      }
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
    console.log(`Gemini Search — grounded academic search via Gemini API

Usage:
  bun gemini-search.ts -- <query> [options]

Options:
  --max-tokens, -m <n>       Max response tokens (default: 4096)
  --help, -h                 Show this help

Examples:
  bun gemini-search.ts -- "transformer architecture advances 2025"
  bun gemini-search.ts -- "CRISPR clinical trials"`);
    process.exit(0);
  }

  const query = positionals.join(" ");
  const maxTokens = Number.parseInt(values["max-tokens"] ?? "4096", 10);

  await geminiSearch(query, maxTokens);
}

if (import.meta.main) void run();

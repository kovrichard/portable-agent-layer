#!/usr/bin/env bun

/**
 * YouTube Analyze — Sends a YouTube URL + prompt to Gemini for video analysis.
 *
 * Gemini can natively process YouTube videos (visual + audio).
 * Requires GEMINI_API_KEY environment variable.
 *
 * Usage:
 *   bun run tool:youtube-analyze -- <youtube-url> [--prompt "your question"]
 *
 * Default prompt extracts a structured summary with key insights.
 */

import { parseArgs } from "node:util";

const DEFAULT_PROMPT = `Analyze this video and provide:
- **Title & Channel**
- **Summary** (3-5 sentences)
- **Key Insights** (bullet points)
- **Topics** covered
- **People & Companies** mentioned (with context)
- **Notable Quotes** (verbatim if possible)`;

const MODEL = "gemini-3.1-flash-lite-preview";

function loadApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("Error: GEMINI_API_KEY environment variable is not set.");
    console.error("Get a free key at https://aistudio.google.com/apikey");
    process.exit(1);
  }
  return key;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      prompt: { type: "string", short: "p" },
    },
  });

  const url = positionals[0];
  if (!url) {
    console.error(
      'Usage: bun run tool:youtube-analyze -- <youtube-url> [--prompt "your question"]'
    );
    process.exit(1);
  }

  if (!url.includes("youtube.com/") && !url.includes("youtu.be/")) {
    console.error("Error: URL does not look like a YouTube link.");
    process.exit(1);
  }

  const apiKey = loadApiKey();
  const prompt = values.prompt ?? DEFAULT_PROMPT;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                fileData: {
                  mimeType: "video/*",
                  fileUri: url,
                },
              },
              { text: prompt },
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    console.error(`Error: HTTP ${response.status} — ${err.slice(0, 500)}`);
    process.exit(1);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error("Error: No response content from Gemini.");
    process.exit(1);
  }

  console.log(text);
}

main();

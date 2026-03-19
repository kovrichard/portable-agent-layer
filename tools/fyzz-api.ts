#!/usr/bin/env bun
/**
 * Fyzz Chat API — CLI wrapper for programmatic conversation access.
 *
 * Reads the API key from FYZZ_API_KEY env var (never printed to stdout).
 * Returns JSON responses from the Fyzz Chat REST API.
 *
 * Usage:
 *   bun run tool:fyzz-api -- conversations [--limit 20] [--search "query"] [--project-id <id>] [--cursor <cursor>]
 *   bun run tool:fyzz-api -- conversations <id>
 *   bun run tool:fyzz-api -- projects
 */

import { parseArgs } from "node:util";

function loadApiKey(): string {
  const key = process.env.FYZZ_API_KEY;
  if (!key) {
    console.error("Error: FYZZ_API_KEY environment variable is not set.");
    console.error("Set it in your shell profile or PAI settings.json env section.");
    process.exit(1);
  }
  return key;
}

async function apiFetch(path: string, params?: Record<string, string>): Promise<unknown> {
  const apiKey = loadApiKey();
  const baseUrl = process.env.FYZZ_BASE_URL ?? "http://localhost:3000";

  const url = new URL(`/api/v1${path}`, baseUrl);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    console.error(`Error: ${response.status} ${response.statusText}`);
    const body = await response.text();
    if (body) console.error(body);
    process.exit(1);
  }

  return response.json();
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  console.log("Usage:");
  console.log(
    "  bun run tool:fyzz-api -- conversations                List conversations"
  );
  console.log(
    "  bun run tool:fyzz-api -- conversations <id>           Get conversation with messages"
  );
  console.log("  bun run tool:fyzz-api -- projects                     List projects");
  console.log("");
  console.log("Options for 'conversations' (list mode):");
  console.log("  --limit <n>          Max results (default 20)");
  console.log("  --search <query>     Search in titles and messages");
  console.log("  --project-id <id>    Filter by project");
  console.log("  --cursor <cursor>    Pagination cursor");
  process.exit(0);
}

if (command === "conversations") {
  const secondArg = args[1];

  if (secondArg && !secondArg.startsWith("--")) {
    const result = await apiFetch(`/conversations/${secondArg}`);
    console.log(JSON.stringify(result, null, 2));
  } else {
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        limit: { type: "string", short: "l", default: "20" },
        search: { type: "string", short: "s" },
        "project-id": { type: "string", short: "p" },
        cursor: { type: "string", short: "c" },
      },
      strict: true,
    });

    const params: Record<string, string> = {};
    if (values.limit) params.limit = values.limit;
    if (values.search) params.search = values.search;
    if (values["project-id"]) params.projectId = values["project-id"];
    if (values.cursor) params.cursor = values.cursor;

    const result = await apiFetch("/conversations", params);
    console.log(JSON.stringify(result, null, 2));
  }
} else if (command === "projects") {
  const result = await apiFetch("/projects");
  console.log(JSON.stringify(result, null, 2));
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Run with --help for usage.");
  process.exit(1);
}

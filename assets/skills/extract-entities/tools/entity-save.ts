#!/usr/bin/env bun
/**
 * Entity Save — ingest extracted entities into the knowledge store.
 *
 * Reads the extract-entities JSON shape from stdin (or --file), upserts each
 * person and company into ~/.pal/memory/knowledge/{People,Companies}/<slug>.md,
 * preserves all rich fields as frontmatter, auto-creates part-of edges when a
 * person record carries a company affiliation, and appends a per-source log
 * to each entity's body so the same source can be re-ingested safely.
 *
 * Usage:
 *   echo '{"people":[...],"companies":[...]}' | bun entity-save.ts -- --source "https://example.com"
 *   bun entity-save.ts -- --file /path/to/extracted.json --source "https://example.com"
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  type CompanyInput,
  ingestEntities,
  type PersonInput,
} from "../../../../src/tools/knowledge/ingest";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    source: { type: "string", short: "s", default: "manual" },
    file: { type: "string", short: "f" },
  },
  strict: true,
});

const sourceId = values.source ?? "manual";

let raw: string;
if (values.file) {
  raw = readFileSync(values.file, "utf-8");
} else {
  raw = await Bun.stdin.text();
}

if (!raw.trim()) {
  console.error("Error: No input provided. Pipe JSON via stdin or use --file.");
  process.exit(1);
}

let data: { people?: PersonInput[]; companies?: CompanyInput[] };
try {
  data = JSON.parse(raw);
} catch {
  console.error("Error: Invalid JSON input.");
  process.exit(1);
}

if (!Array.isArray(data.people) && !Array.isArray(data.companies)) {
  console.error('Error: JSON must have at least one of "people" or "companies" arrays.');
  process.exit(1);
}

const result = ingestEntities(
  {
    people: data.people ?? [],
    companies: data.companies ?? [],
  },
  sourceId
);

const summary = {
  source: sourceId,
  people: {
    total: result.people.length,
    created: result.people.filter((p) => p.created).length,
    updated: result.people.filter((p) => !p.created).length,
    slugs: result.people.map((p) => p.slug),
  },
  companies: {
    total: result.companies.length,
    created: result.companies.filter((c) => c.created).length,
    updated: result.companies.filter((c) => !c.created).length,
    slugs: result.companies.map((c) => c.slug),
  },
};

console.log(JSON.stringify(summary, null, 2));

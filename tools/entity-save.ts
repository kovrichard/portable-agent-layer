#!/usr/bin/env bun
/**
 * Entity Save — Deduplicate and persist extracted entities.
 *
 * Accepts extracted people/companies JSON via stdin or --file,
 * deduplicates against the entity index, and saves.
 *
 * Usage:
 *   echo '{"people":[...],"companies":[...]}' | bun run ai:entity-save -- --source "https://example.com"
 *   bun run ai:entity-save -- --file /path/to/extracted.json --source "https://example.com"
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadEntityIndex, processEntities } from "../hooks/lib/entities";

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

let data: {
  people: Array<Record<string, unknown>>;
  companies: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
  sources?: Array<Record<string, unknown>>;
};
try {
  data = JSON.parse(raw);
} catch {
  console.error("Error: Invalid JSON input.");
  process.exit(1);
}

if (!Array.isArray(data.people) || !Array.isArray(data.companies)) {
  console.error('Error: JSON must have "people" and "companies" arrays.');
  process.exit(1);
}
data.links ??= [];
data.sources ??= [];

const before = loadEntityIndex();
const counts = (idx: ReturnType<typeof loadEntityIndex>) => ({
  people: Object.keys(idx.people).length,
  companies: Object.keys(idx.companies).length,
  links: Object.keys(idx.links).length,
  sources: Object.keys(idx.sources).length,
});
const cb = counts(before);

const result = processEntities(
  {
    people: data.people as Array<{ name: string; [key: string]: unknown }>,
    companies: data.companies as Array<{
      name: string;
      domain: string | null;
      [key: string]: unknown;
    }>,
    links: data.links as Array<{ url: string; [key: string]: unknown }>,
    sources: data.sources as Array<{
      url: string | null;
      author: string | null;
      publication: string | null;
      [key: string]: unknown;
    }>,
  },
  sourceId
);

const ca = counts(loadEntityIndex());

console.log(
  JSON.stringify(
    {
      saved: {
        people: result.people.length,
        companies: result.companies.length,
        links: result.links.length,
        sources: result.sources.length,
      },
      new: {
        people: ca.people - cb.people,
        companies: ca.companies - cb.companies,
        links: ca.links - cb.links,
        sources: ca.sources - cb.sources,
      },
      total: ca,
    },
    null,
    2
  )
);

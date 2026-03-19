#!/usr/bin/env bun
/**
 * Entity Save — Deduplicate and persist extracted entities.
 *
 * Accepts extracted people/companies JSON via stdin or --file,
 * deduplicates against the entity index, and saves.
 *
 * Usage:
 *   echo '{"people":[...],"companies":[...]}' | bun run tool:entity-save -- --source "https://example.com"
 *   bun run tool:entity-save -- --file /path/to/extracted.json --source "https://example.com"
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

const before = loadEntityIndex();
const peopleBefore = Object.keys(before.people).length;
const companiesBefore = Object.keys(before.companies).length;

const result = processEntities(
  {
    people: data.people as Array<{ name: string; [key: string]: unknown }>,
    companies: data.companies as Array<{
      name: string;
      domain: string | null;
      [key: string]: unknown;
    }>,
  },
  sourceId
);

const after = loadEntityIndex();
const peopleAfter = Object.keys(after.people).length;
const companiesAfter = Object.keys(after.companies).length;

const newPeople = peopleAfter - peopleBefore;
const newCompanies = companiesAfter - companiesBefore;

console.log(
  JSON.stringify(
    {
      saved: {
        people: result.people.length,
        companies: result.companies.length,
      },
      new: { people: newPeople, companies: newCompanies },
      existing: {
        people: result.people.length - newPeople,
        companies: result.companies.length - newCompanies,
      },
      total: { people: peopleAfter, companies: companiesAfter },
    },
    null,
    2
  )
);

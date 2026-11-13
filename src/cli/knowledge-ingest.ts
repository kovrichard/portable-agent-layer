import { readFileSync } from "node:fs";
import { toPath } from "../hooks/lib/paths";
import {
  type CompanyInput,
  ingestEntities,
  type PersonInput,
} from "../tools/knowledge/ingest";
import { UsageError } from "../tools/lib/command";

interface IngestPayload {
  people?: PersonInput[];
  companies?: CompanyInput[];
}

async function readIngestInput(file: string | undefined): Promise<string | null> {
  if (file) return readFileSync(toPath(file), "utf-8");

  if (process.stdin.isTTY) return null;

  return await Bun.stdin.text();
}

export async function cmdIngest(
  sourceId: string,
  file: string | undefined
): Promise<number> {
  const raw = await readIngestInput(file);
  if (raw === null || !raw.trim()) {
    throw new UsageError("pipe the JSON on stdin or pass --file <path>");
  }

  let data: IngestPayload;

  try {
    data = JSON.parse(raw) as IngestPayload;
  } catch {
    console.error("Error: invalid JSON input.");

    return 1;
  }

  if (!Array.isArray(data.people) && !Array.isArray(data.companies)) {
    console.error(
      'Error: JSON must include at least one of "people" or "companies" arrays.'
    );

    return 1;
  }

  const result = ingestEntities(
    { people: data.people ?? [], companies: data.companies ?? [] },
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

  return 0;
}

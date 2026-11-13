import { existsSync, readFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { palHome } from "../../hooks/lib/paths";
import { appendSourceLog } from "../../tools/knowledge/ingest";
import {
  type Entity,
  type EntityFrontmatter,
  exists as knowledgeExists,
  save as knowledgeSave,
  slugify,
} from "../../tools/knowledge/lib";
import type { Migration, MigrationResult } from "./migration";

interface LegacyPerson {
  id: string;
  name: string;
  first_seen: string;
  occurrences: number;
  source_ids: string[];
}

interface LegacyCompany {
  id: string;
  name: string;
  domain: string | null;
  first_seen: string;
  occurrences: number;
  source_ids: string[];
}

interface LegacyIndex {
  version?: string;
  people?: Record<string, LegacyPerson>;
  companies?: Record<string, LegacyCompany>;
  links?: Record<string, unknown>;
  sources?: Record<string, unknown>;
}

function legacyEntitiesPath(): string {
  // Read from PAL_HOME-aware location to match where the legacy store lived;
  // computed locally now that paths.entities() is being retired alongside this migration.
  const home = palHome();
  const dir = resolve(home, "memory", "entities");

  return resolve(dir, "entity-index.json");
}

function readLegacyIndex(): LegacyIndex | null {
  const p = legacyEntitiesPath();
  if (!existsSync(p)) return null;

  try {
    return JSON.parse(readFileSync(p, "utf-8")) as LegacyIndex;
  } catch {
    return null;
  }
}

function countLegacyEntries(idx: LegacyIndex): number {
  return Object.keys(idx.people ?? {}).length + Object.keys(idx.companies ?? {}).length;
}

function legacyPersonToEntity(legacy: LegacyPerson): Entity {
  const fm: EntityFrontmatter = {
    title: legacy.name,
    type: "person",
    tags: [],
    created: legacy.first_seen,
    updated: legacy.first_seen,
    quality: 5,
    status: "seedling",
    related: [],
    legacy_id: legacy.id,
    occurrences: legacy.occurrences,
  };
  let body = "";

  for (const sourceId of legacy.source_ids) {
    body = appendSourceLog(body, sourceId, null, {}, legacy.first_seen);
  }

  return { domain: "People", slug: slugify(legacy.name), frontmatter: fm, body };
}

function legacyCompanyToEntity(legacy: LegacyCompany): Entity {
  const baseKey = legacy.domain?.trim() ? legacy.domain : legacy.name;
  const fm: EntityFrontmatter = {
    title: legacy.name,
    type: "company",
    tags: [],
    created: legacy.first_seen,
    updated: legacy.first_seen,
    quality: 5,
    status: "seedling",
    related: [],
    legacy_id: legacy.id,
    occurrences: legacy.occurrences,
  };

  if (legacy.domain) fm.domain_name = legacy.domain;
  let body = "";

  for (const sourceId of legacy.source_ids) {
    body = appendSourceLog(body, sourceId, null, {}, legacy.first_seen);
  }

  return { domain: "Companies", slug: slugify(baseKey), frontmatter: fm, body };
}

export const v3EntitiesToKnowledge: Migration = {
  id: "v3-entities-to-knowledge",
  description: "Migrate legacy entity-index.json to knowledge/{People,Companies}/*.md",

  check() {
    const idx = readLegacyIndex();
    if (!idx) return { pending: false };
    const total = countLegacyEntries(idx);
    if (total === 0) return { pending: false };
    // Skip if every entity already exists in the new store (idempotent).
    let remaining = 0;

    for (const p of Object.values(idx.people ?? {})) {
      if (!knowledgeExists("People", slugify(p.name))) remaining++;
    }

    for (const c of Object.values(idx.companies ?? {})) {
      const key = c.domain?.trim() ? c.domain : c.name;
      if (!knowledgeExists("Companies", slugify(key))) remaining++;
    }

    return {
      pending: remaining > 0,
      detail: remaining > 0 ? `${remaining} of ${total} entries to migrate` : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const idx = readLegacyIndex();
    if (!idx) return { migrated: 0, skipped: 0, results: [] };

    // Refuse to silently drop links/sources if a future legacy index has them.
    const linksCount = Object.keys(idx.links ?? {}).length;
    const sourcesCount = Object.keys(idx.sources ?? {}).length;
    if (linksCount > 0 || sourcesCount > 0) {
      return {
        migrated: 0,
        skipped: linksCount + sourcesCount,
        results: [
          `aborted: legacy index has ${linksCount} link(s) and ${sourcesCount} source(s) — no destination in new store`,
        ],
      };
    }

    const tally: MigrationResult = { migrated: 0, skipped: 0, results: [] };
    const people = Object.values(idx.people ?? {}).map(legacyPersonToEntity);
    const companies = Object.values(idx.companies ?? {}).map(legacyCompanyToEntity);

    for (const entity of [...people, ...companies]) {
      migrateEntity(entity, dryRun, tally);
    }

    if (!dryRun && tally.migrated > 0) archiveLegacyIndex(tally.results);

    return tally;
  },
};

function migrateEntity(entity: Entity, dryRun: boolean, tally: MigrationResult): void {
  const label = `${entity.domain}/${entity.slug}`;

  if (knowledgeExists(entity.domain, entity.slug)) {
    tally.skipped++;
    tally.results.push(`${label}: skipped (already in new store)`);

    return;
  }

  if (!dryRun) knowledgeSave(entity);
  tally.migrated++;
  tally.results.push(`${label}: ${dryRun ? "would migrate" : "migrated"}`);
}

/** So re-runs don't repeatedly load and skip the legacy contents. */
function archiveLegacyIndex(results: string[]): void {
  const src = legacyEntitiesPath();
  if (!existsSync(src)) return;
  const date = new Date().toISOString().slice(0, 10);
  const archived = `${src}.migrated-${date}`;

  try {
    renameSync(src, archived);
    results.push(`archived legacy index → ${archived}`);
  } catch (e) {
    results.push(`warn: could not rename legacy index (${(e as Error).message})`);
  }
}

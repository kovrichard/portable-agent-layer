/**
 * Entity Collision Detection — deduplicates people and companies
 * across extracted content, assigning stable UUIDs and tracking
 * occurrences to build a knowledge graph.
 *
 * Ported from ~/git/Personal_AI_Infrastructure/Packs/Utilities/src/Parser/Utils/collision-detection.ts
 * Simplified: people + companies only (no links/sources).
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "./paths";

// --- Types ---

export interface PersonEntity {
  id: string;
  name: string;
  first_seen: string;
  occurrences: number;
  source_ids: string[];
}

export interface CompanyEntity {
  id: string;
  name: string;
  domain: string | null;
  first_seen: string;
  occurrences: number;
  source_ids: string[];
}

export interface EntityIndex {
  version: string;
  last_updated: string;
  people: Record<string, PersonEntity>;
  companies: Record<string, CompanyEntity>;
}

// --- Normalization ---

export function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

export function normalizeCompanyKey(name: string, domain: string | null): string {
  return domain ? domain.toLowerCase().trim() : normalizeName(name);
}

// --- Index I/O ---

function defaultIndexPath(): string {
  return resolve(ensureDir(paths.entities()), "entity-index.json");
}

function emptyIndex(): EntityIndex {
  return {
    version: "1.0.0",
    last_updated: new Date().toISOString(),
    people: {},
    companies: {},
  };
}

export function loadEntityIndex(filepath?: string): EntityIndex {
  const p = filepath ?? defaultIndexPath();
  if (!existsSync(p)) return emptyIndex();
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return emptyIndex();
  }
}

export function saveEntityIndex(index: EntityIndex, filepath?: string): void {
  const p = filepath ?? defaultIndexPath();
  const tempPath = `${p}.tmp`;
  index.last_updated = new Date().toISOString();
  writeFileSync(tempPath, JSON.stringify(index, null, 2), "utf-8");
  renameSync(tempPath, p);
}

// --- Deduplication ---

export function getOrCreatePerson(
  person: { name: string },
  index: EntityIndex,
  sourceId: string
): string {
  const key = normalizeName(person.name);
  const existing = index.people[key];

  if (existing) {
    if (!existing.source_ids.includes(sourceId)) {
      existing.occurrences++;
      existing.source_ids.push(sourceId);
    }
    return existing.id;
  }

  const id = crypto.randomUUID();
  index.people[key] = {
    id,
    name: person.name,
    first_seen: new Date().toISOString(),
    occurrences: 1,
    source_ids: [sourceId],
  };
  return id;
}

export function getOrCreateCompany(
  company: { name: string; domain: string | null },
  index: EntityIndex,
  sourceId: string
): string {
  const key = normalizeCompanyKey(company.name, company.domain);
  const existing = index.companies[key];

  if (existing) {
    if (!existing.source_ids.includes(sourceId)) {
      existing.occurrences++;
      existing.source_ids.push(sourceId);
    }
    return existing.id;
  }

  const id = crypto.randomUUID();
  index.companies[key] = {
    id,
    name: company.name,
    domain: company.domain,
    first_seen: new Date().toISOString(),
    occurrences: 1,
    source_ids: [sourceId],
  };
  return id;
}

// --- Batch processing ---

export function processEntities(
  extractedData: {
    people: Array<{ name: string; [key: string]: unknown }>;
    companies: Array<{
      name: string;
      domain: string | null;
      [key: string]: unknown;
    }>;
  },
  sourceId: string,
  indexPath?: string
): {
  people: Array<{ id: string; [key: string]: unknown }>;
  companies: Array<{ id: string; [key: string]: unknown }>;
} {
  const index = loadEntityIndex(indexPath);

  const people = extractedData.people.map((person) => ({
    ...person,
    id: getOrCreatePerson(person, index, sourceId),
  }));

  const companies = extractedData.companies.map((company) => ({
    ...company,
    id: getOrCreateCompany(company, index, sourceId),
  }));

  saveEntityIndex(index, indexPath);

  return { people, companies };
}

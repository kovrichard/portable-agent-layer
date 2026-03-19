/**
 * Entity Collision Detection — deduplicates people, companies, links,
 * and sources across extracted content, assigning stable UUIDs and
 * tracking occurrences to build a knowledge graph.
 *
 * Ported from ~/git/Personal_AI_Infrastructure/Packs/Utilities/src/Parser/Utils/collision-detection.ts
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

export interface LinkEntity {
  id: string;
  url: string;
  first_seen: string;
  occurrences: number;
  source_ids: string[];
}

export interface SourceEntity {
  id: string;
  url: string | null;
  author: string | null;
  publication: string | null;
  first_seen: string;
  occurrences: number;
  source_ids: string[];
}

export interface EntityIndex {
  version: string;
  last_updated: string;
  people: Record<string, PersonEntity>;
  companies: Record<string, CompanyEntity>;
  links: Record<string, LinkEntity>;
  sources: Record<string, SourceEntity>;
}

// --- Normalization ---

export function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

export function normalizeCompanyKey(name: string, domain: string | null): string {
  return domain ? domain.toLowerCase().trim() : normalizeName(name);
}

export function normalizeUrl(url: string): string {
  return url.toLowerCase().trim().replace(/\/$/, "");
}

export function normalizeSourceKey(
  url: string | null,
  author: string | null,
  publication: string | null
): string {
  if (url) return normalizeUrl(url);
  const a = author ? normalizeName(author) : "";
  const p = publication ? normalizeName(publication) : "";
  return `${a}|${p}`;
}

// --- Index I/O ---

function defaultIndexPath(): string {
  return resolve(ensureDir(paths.entities()), "entity-index.json");
}

function emptyIndex(): EntityIndex {
  return {
    version: "1.1.0",
    last_updated: new Date().toISOString(),
    people: {},
    companies: {},
    links: {},
    sources: {},
  };
}

/** Migrate older indexes that lack links/sources. */
function ensureShape(index: EntityIndex): EntityIndex {
  if (!index.links) index.links = {};
  if (!index.sources) index.sources = {};
  return index;
}

export function loadEntityIndex(filepath?: string): EntityIndex {
  const p = filepath ?? defaultIndexPath();
  if (!existsSync(p)) return emptyIndex();
  try {
    return ensureShape(JSON.parse(readFileSync(p, "utf-8")));
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

export function getOrCreateLink(
  link: { url: string },
  index: EntityIndex,
  sourceId: string
): string {
  const key = normalizeUrl(link.url);
  const existing = index.links[key];

  if (existing) {
    if (!existing.source_ids.includes(sourceId)) {
      existing.occurrences++;
      existing.source_ids.push(sourceId);
    }
    return existing.id;
  }

  const id = crypto.randomUUID();
  index.links[key] = {
    id,
    url: link.url,
    first_seen: new Date().toISOString(),
    occurrences: 1,
    source_ids: [sourceId],
  };
  return id;
}

export function getOrCreateSource(
  source: { url: string | null; author: string | null; publication: string | null },
  index: EntityIndex,
  sourceId: string
): string {
  const key = normalizeSourceKey(source.url, source.author, source.publication);
  const existing = index.sources[key];

  if (existing) {
    if (!existing.source_ids.includes(sourceId)) {
      existing.occurrences++;
      existing.source_ids.push(sourceId);
    }
    return existing.id;
  }

  const id = crypto.randomUUID();
  index.sources[key] = {
    id,
    url: source.url,
    author: source.author,
    publication: source.publication,
    first_seen: new Date().toISOString(),
    occurrences: 1,
    source_ids: [sourceId],
  };
  return id;
}

/** Check if a URL has already been parsed (exists in the links index). */
export function isUrlAlreadyParsed(url: string, index: EntityIndex): boolean {
  const key = normalizeUrl(url);
  const link = index.links[key];
  return !!link && link.source_ids.length > 0;
}

/** Get the first source_id that referenced this URL, or null. */
export function getExistingContentId(url: string, index: EntityIndex): string | null {
  const key = normalizeUrl(url);
  const link = index.links[key];
  return link?.source_ids[0] ?? null;
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
    links?: Array<{ url: string; [key: string]: unknown }>;
    sources?: Array<{
      url: string | null;
      author: string | null;
      publication: string | null;
      [key: string]: unknown;
    }>;
  },
  sourceId: string,
  indexPath?: string
): {
  people: Array<{ id: string; [key: string]: unknown }>;
  companies: Array<{ id: string; [key: string]: unknown }>;
  links: Array<{ id: string; [key: string]: unknown }>;
  sources: Array<{ id: string; [key: string]: unknown }>;
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

  const links = (extractedData.links ?? []).map((link) => ({
    ...link,
    id: getOrCreateLink(link, index, sourceId),
  }));

  const sources = (extractedData.sources ?? []).map((source) => ({
    ...source,
    id: getOrCreateSource(source, index, sourceId),
  }));

  saveEntityIndex(index, indexPath);

  return { people, companies, links, sources };
}

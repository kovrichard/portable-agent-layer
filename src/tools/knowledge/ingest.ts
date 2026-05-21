/**
 * Knowledge ingest — merge extracted entities into the markdown store.
 *
 * Called by the `pal cli knowledge ingest` subcommand (which the `entities`
 * skill drives). Accepts the canonical entity extraction JSON shape and:
 *
 *   1. Upserts each person and company as a markdown file (Phase 1 store).
 *   2. Preserves all rich fields (role, social, context, industry, etc.) as
 *      frontmatter — old behavior dropped these.
 *   3. Auto-creates a `part-of` related edge when a person record carries a
 *      `company` field (and stub-creates the company if missing).
 *   4. Appends a per-source log section to the body, fingerprinted with the
 *      sourceId so re-ingesting the same source is idempotent.
 *
 * Merge rule: a non-null value in the new payload updates the entity;
 * null/undefined leaves the prior value intact. Arrays (socials, tags) are
 * unioned, not overwritten.
 */

import {
  type Entity,
  type EntityFrontmatter,
  list,
  load,
  type Related,
  save,
  slugify,
} from "./lib";

// --- Public input shape -----------------------------------------------------

export interface PersonInput {
  name: string;
  role?: string | null;
  title?: string | null;
  company?: string | null;
  social?: Record<string, string | null> | null;
  context?: string | null;
  importance?: "primary" | "secondary" | "minor" | null;
  [extra: string]: unknown;
}

export interface CompanyInput {
  name: string;
  domain?: string | null;
  industry?: string | null;
  context?: string | null;
  mentioned_as?: string | null;
  sentiment?: "positive" | "neutral" | "negative" | "mixed" | null;
  [extra: string]: unknown;
}

export interface IngestInput {
  people?: PersonInput[];
  companies?: CompanyInput[];
}

export interface IngestResult {
  people: Array<{ slug: string; created: boolean }>;
  companies: Array<{ slug: string; created: boolean }>;
}

// --- Constants --------------------------------------------------------------

const SOURCE_MARKER_PREFIX = "<!-- src:";
const SOURCE_MARKER_SUFFIX = " -->";

// --- Field merge ------------------------------------------------------------

/** Non-null new wins; null/undefined leaves prior intact. */
function mergeScalar<T>(prior: T | undefined, next: T | null | undefined): T | undefined {
  if (next === null || next === undefined) return prior;
  return next;
}

/** Union arrays of strings, preserving first-seen order. */
function mergeStringArray(
  prior: string[] | undefined,
  next: string[] | undefined
): string[] {
  const out = [...(prior ?? [])];
  const seen = new Set(out);
  for (const item of next ?? []) {
    if (!seen.has(item)) {
      out.push(item);
      seen.add(item);
    }
  }
  return out;
}

/** Merge two `socials` objects: non-null values from new override prior. */
function mergeSocials(
  prior: unknown,
  next: Record<string, string | null> | null | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (prior && typeof prior === "object") {
    for (const [k, v] of Object.entries(prior as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0) out[k] = v;
    }
  }
  for (const [k, v] of Object.entries(next ?? {})) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}

/** Add a `Related` edge if not already present (by slug+type). */
function addRelated(list: Related[], rel: Related): Related[] {
  for (const existing of list) {
    if (existing.slug === rel.slug && existing.type === rel.type) return list;
  }
  return [...list, rel];
}

/**
 * Split a company industry string into atomic, topic-prefixed tags.
 * Whitespace and `/` are separators; hyphens preserved (so `ai-research`
 * stays one token). Each token gets the `topic:` prefix so the graph
 * builder can recognize them as facet-style filters and skip them when
 * generating tag co-occurrence edges (ISC-18 — prevents phantom edges
 * between unrelated entities that merely share an industry word).
 */
function industryToTopicTags(industry: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of industry.toLowerCase().split(/[\s/]+/)) {
    if (!token) continue;
    const prefixed = `topic:${token}`;
    if (!seen.has(prefixed)) {
      seen.add(prefixed);
      out.push(prefixed);
    }
  }
  return out;
}

// --- Source log -------------------------------------------------------------

function sourceMarker(sourceId: string): string {
  return `${SOURCE_MARKER_PREFIX}${sourceId}${SOURCE_MARKER_SUFFIX}`;
}

function bodyHasSource(body: string, sourceId: string): boolean {
  return body.includes(sourceMarker(sourceId));
}

/**
 * Append a per-source section to the body. Idempotent on `sourceId`.
 *
 * `date` defaults to today's ISO date. The legacy-store migration overrides
 * it with each entity's original `first_seen` so replayed provenance retains
 * its real date instead of stamping today on every record.
 */
export function appendSourceLog(
  body: string,
  sourceId: string,
  contextSnippet: string | null | undefined,
  attrs: Record<string, string | null | undefined>,
  date?: string
): string {
  if (bodyHasSource(body, sourceId)) return body;
  const dateStr = (date ?? new Date().toISOString()).slice(0, 10);
  const attrLine = Object.entries(attrs)
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  const lines: string[] = ["", `### ${dateStr} — ${sourceId}`, sourceMarker(sourceId)];
  if (attrLine) lines.push(attrLine);
  if (contextSnippet?.trim()) lines.push("", contextSnippet.trim());
  const prefix = body.endsWith("\n") || body === "" ? body : `${body}\n`;
  return `${prefix}${lines.join("\n")}\n`;
}

// --- Per-domain upsert ------------------------------------------------------

interface UpsertResult {
  slug: string;
  created: boolean;
  entity: Entity;
}

function newPersonEntity(input: PersonInput, slug: string): Entity {
  const now = new Date().toISOString();
  const fm: EntityFrontmatter = {
    title: input.name,
    type: "person",
    tags: [],
    created: now,
    updated: now,
    quality: 5,
    status: "seedling",
    related: [],
  };
  if (input.role) fm.role = input.role;
  if (input.title) fm.position = input.title;
  if (input.company) fm.company = input.company;
  if (input.importance) fm.importance = input.importance;
  const socials = mergeSocials(undefined, input.social);
  if (Object.keys(socials).length > 0) {
    fm.socials = Object.entries(socials).map(([k, v]) => `${k}:${v}`);
  }
  return { domain: "People", slug, frontmatter: fm, body: "" };
}

function newCompanyEntity(input: CompanyInput, slug: string): Entity {
  const now = new Date().toISOString();
  const fm: EntityFrontmatter = {
    title: input.name,
    type: "company",
    tags: input.industry ? industryToTopicTags(input.industry) : [],
    created: now,
    updated: now,
    quality: 5,
    status: "seedling",
    related: [],
  };
  if (input.domain) fm.domain_name = input.domain;
  if (input.industry) fm.industry = input.industry;
  if (input.mentioned_as) fm.mentioned_as = input.mentioned_as;
  if (input.sentiment) fm.sentiment = input.sentiment;
  return { domain: "Companies", slug, frontmatter: fm, body: "" };
}

function mergePerson(prior: Entity, input: PersonInput): Entity {
  const fm = { ...prior.frontmatter };
  fm.role = mergeScalar(fm.role, input.role);
  fm.position = mergeScalar(fm.position, input.title);
  fm.company = mergeScalar(fm.company, input.company);
  fm.importance = mergeScalar(fm.importance, input.importance);
  const socials = mergeSocials(
    Array.isArray(fm.socials)
      ? Object.fromEntries(
          (fm.socials as string[])
            .map((entry): [string, string] | null => {
              // Split on FIRST ':' only — values like 'https://...' contain
              // additional colons that must stay inside the value.
              const idx = entry.indexOf(":");
              if (idx <= 0) return null;
              return [entry.slice(0, idx), entry.slice(idx + 1)];
            })
            .filter((kv): kv is [string, string] => kv !== null && kv[1].length > 0)
        )
      : (fm.socials ?? {}),
    input.social
  );
  if (Object.keys(socials).length > 0) {
    fm.socials = Object.entries(socials).map(([k, v]) => `${k}:${v}`);
  }
  return { ...prior, frontmatter: fm };
}

function mergeCompany(prior: Entity, input: CompanyInput): Entity {
  const fm = { ...prior.frontmatter };
  fm.domain_name = mergeScalar(fm.domain_name, input.domain);
  fm.industry = mergeScalar(fm.industry, input.industry);
  fm.mentioned_as = mergeScalar(fm.mentioned_as, input.mentioned_as);
  fm.sentiment = mergeScalar(fm.sentiment, input.sentiment);
  if (input.industry) {
    fm.tags = mergeStringArray(fm.tags, industryToTopicTags(input.industry));
  }
  return { ...prior, frontmatter: fm };
}

function upsertPerson(
  input: PersonInput,
  sourceId: string,
  rootDir?: string
): UpsertResult {
  const slug = slugify(input.name);
  if (!slug) throw new Error(`ingest: cannot slugify person name "${input.name}"`);
  const prior = load("People", slug, rootDir);
  const created = prior === null;
  let entity = prior ? mergePerson(prior, input) : newPersonEntity(input, slug);
  entity = {
    ...entity,
    frontmatter: {
      ...entity.frontmatter,
      updated: new Date().toISOString(),
    },
    body: appendSourceLog(entity.body, sourceId, input.context, {
      role: input.role ?? null,
      importance: input.importance ?? null,
    }),
  };
  save(entity, rootDir);
  return { slug, created, entity };
}

function upsertCompany(
  input: CompanyInput,
  sourceId: string,
  rootDir?: string
): UpsertResult {
  const baseKey = input.domain?.trim() ? input.domain : input.name;
  const slug = slugify(baseKey);
  if (!slug) throw new Error(`ingest: cannot slugify company "${input.name}"`);
  const prior = load("Companies", slug, rootDir);
  const created = prior === null;
  let entity = prior ? mergeCompany(prior, input) : newCompanyEntity(input, slug);
  entity = {
    ...entity,
    frontmatter: {
      ...entity.frontmatter,
      updated: new Date().toISOString(),
    },
    body: appendSourceLog(entity.body, sourceId, input.context, {
      mentioned_as: input.mentioned_as ?? null,
      sentiment: input.sentiment ?? null,
    }),
  };
  save(entity, rootDir);
  return { slug, created, entity };
}

/**
 * Ensure a `part-of` edge from person → company.
 *
 * `nameToSlug` is the lookup built from companies ingested in this call — it
 * lets us prefer a domain-derived slug ("acme.example" → "acme-example") over
 * the naive name-derived one ("Acme Labs" → "acme-labs") when the same
 * payload defines both. Falls back to slugify(name) when no match, and
 * stub-creates the company so the edge has a target.
 */
/**
 * Find an existing Companies entity whose frontmatter title matches `name`
 * (case-insensitive). Used by `linkPersonToCompany` to avoid stubbing a
 * duplicate when the canonical company already lives at a non-name-derived
 * slug (e.g. domain-derived "acme-example" for "Acme Labs"). ISC-21.
 */
function findExistingCompanyByTitle(name: string, rootDir?: string): string | null {
  const target = name.toLowerCase();
  for (const e of list("Companies", rootDir)) {
    if (e.frontmatter.title.toLowerCase() === target) return e.slug;
  }
  return null;
}

function linkPersonToCompany(
  personSlug: string,
  companyName: string,
  nameToSlug: Map<string, string>,
  sourceId: string,
  rootDir?: string
): void {
  // Resolution order: (1) in-call lookup map (domain-derived slug wins when
  // the same payload defines both), (2) existing-store title scan (ISC-21
  // — re-ingest of a person referencing an already-known company), (3)
  // fall back to slugify(name) and stub the company.
  const companySlug =
    nameToSlug.get(companyName.toLowerCase()) ??
    findExistingCompanyByTitle(companyName, rootDir) ??
    slugify(companyName);
  if (!companySlug) return;
  if (!load("Companies", companySlug, rootDir)) {
    upsertCompany({ name: companyName }, sourceId, rootDir);
  }
  const person = load("People", personSlug, rootDir);
  if (!person) return;
  // ISC-18: inherit ONLY the company's topic:* tags. Structural tags stay
  // company-scoped so we don't create phantom graph edges between unrelated
  // people sharing only their employer's slug or other non-facet labels.
  const company = load("Companies", companySlug, rootDir);
  const inheritedTopicTags = company
    ? company.frontmatter.tags.filter((t) => t.startsWith("topic:"))
    : [];
  const updated: Entity = {
    ...person,
    frontmatter: {
      ...person.frontmatter,
      related: addRelated(person.frontmatter.related, {
        slug: companySlug,
        type: "part-of",
      }),
      tags: mergeStringArray(person.frontmatter.tags, inheritedTopicTags),
    },
  };
  save(updated, rootDir);
}

// --- Public API -------------------------------------------------------------

export function ingestEntities(
  input: IngestInput,
  sourceId: string,
  rootDir?: string
): IngestResult {
  // Ingest companies first so person→company links can resolve to the
  // canonical (possibly domain-derived) slug rather than guessing.
  const companies = (input.companies ?? []).map((c) => {
    const r = upsertCompany(c, sourceId, rootDir);
    return { slug: r.slug, created: r.created, name: c.name };
  });
  const nameToSlug = new Map<string, string>(
    companies.map((c) => [c.name.toLowerCase(), c.slug])
  );
  const people = (input.people ?? []).map((p) => {
    const r = upsertPerson(p, sourceId, rootDir);
    if (p.company) {
      linkPersonToCompany(r.slug, p.company, nameToSlug, sourceId, rootDir);
    }
    return { slug: r.slug, created: r.created };
  });
  return {
    people,
    companies: companies.map(({ slug, created }) => ({ slug, created })),
  };
}

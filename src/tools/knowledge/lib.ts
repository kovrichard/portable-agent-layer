/**
 * Knowledge — markdown-per-entity store with typed relationships.
 *
 * Each entity lives at:
 *   ~/.pal/memory/knowledge/<Domain>/<slug>.md
 *
 * Frontmatter schema (canonical fields):
 *   title:    human label
 *   type:     free-form sub-type (e.g. "person", "ai-lab")
 *   tags:     string[]
 *   created:  ISO timestamp
 *   updated:  ISO timestamp
 *   quality:  0-10
 *   status:   seedling | budding | evergreen
 *   related:  Array<{ slug, type }>  -- type ∈ RELATION_TYPES
 *
 * Any additional frontmatter keys (role, company, sentiment, etc.) are
 * preserved verbatim so domain-specific extractors can store rich
 * attributes without changing the core schema.
 *
 * Ported from PAI's KNOWLEDGE/ pattern (see
 * Personal_AI_Infrastructure/Releases/v5.0.0/.claude/PAI/TOOLS/KnowledgeGraph.ts).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "../../hooks/lib/paths";

// --- Constants --------------------------------------------------------------

export const DOMAINS = ["People", "Companies", "Ideas", "Research"] as const;
export type Domain = (typeof DOMAINS)[number];

const DEFAULT_TYPE_BY_DOMAIN: Record<Domain, string> = {
  People: "person",
  Companies: "company",
  Ideas: "idea",
  Research: "research",
};

export const RELATION_TYPES = [
  "supports",
  "contradicts",
  "extends",
  "part-of",
  "instance-of",
  "caused-by",
  "preceded-by",
  "related",
] as const;
/** @lintignore — consumed by Phase 2 graph layer and Phase 3 extract-entities rewire */
export type RelationType = (typeof RELATION_TYPES)[number];

export const STATUSES = ["seedling", "budding", "evergreen"] as const;
/** @lintignore — consumed by Phase 3 extract-entities rewire */
export type Status = (typeof STATUSES)[number];

const CANONICAL_KEYS = new Set([
  "title",
  "type",
  "tags",
  "created",
  "updated",
  "quality",
  "status",
  "related",
]);

// --- Types ------------------------------------------------------------------

/** @lintignore — consumed by Phase 2 graph layer and Phase 3 extract-entities rewire */
export interface Related {
  slug: string;
  type: RelationType;
}

/** @lintignore — consumed by Phase 3 extract-entities rewire */
export interface EntityFrontmatter {
  title: string;
  type: string;
  tags: string[];
  created: string;
  updated: string;
  quality: number;
  status: Status;
  related: Related[];
  [key: string]: unknown;
}

export interface Entity {
  domain: Domain;
  slug: string;
  frontmatter: EntityFrontmatter;
  body: string;
}

// --- Slug -------------------------------------------------------------------

/**
 * Deterministic slug: NFKD-normalize, strip diacritics, lowercase, replace
 * any run of non-alnum chars with a single dash, trim leading/trailing dashes.
 */
export function slugify(input: string): string {
  const normalized = input.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const kebab = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return kebab;
}

// --- YAML emitter (bounded schema) -----------------------------------------

function emitScalar(v: unknown): string {
  if (v === null || v === undefined) return '""';
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(String(v));
}

function emitStringArray(arr: readonly string[]): string {
  if (arr.length === 0) return "[]";
  return `[${arr.map((s) => JSON.stringify(s)).join(", ")}]`;
}

function emitFrontmatter(fm: EntityFrontmatter): string {
  const lines: string[] = [
    "---",
    `title: ${emitScalar(fm.title)}`,
    `type: ${emitScalar(fm.type)}`,
    `tags: ${emitStringArray(fm.tags)}`,
    `created: ${emitScalar(fm.created)}`,
    `updated: ${emitScalar(fm.updated)}`,
    `quality: ${fm.quality}`,
    `status: ${emitScalar(fm.status)}`,
  ];

  if (fm.related.length === 0) {
    lines.push("related: []");
  } else {
    lines.push("related:");
    for (const r of fm.related) {
      lines.push(`  - slug: ${emitScalar(r.slug)}`, `    type: ${emitScalar(r.type)}`);
    }
  }

  for (const [k, v] of Object.entries(fm)) {
    if (CANONICAL_KEYS.has(k)) continue;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.every((x) => typeof x === "string")) {
        lines.push(`${k}: ${emitStringArray(v as string[])}`);
      }
      // Other array shapes are out of scope in v1 — skipped silently.
      continue;
    }
    if (typeof v === "object") {
      // Nested objects out of scope in v1.
      continue;
    }
    lines.push(`${k}: ${emitScalar(v)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

// --- YAML parser (bounded schema) ------------------------------------------

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseStringArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "[]") return [];
  if (!(trimmed.startsWith("[") && trimmed.endsWith("]"))) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (inner === "") return [];
  // Split on commas not inside quotes.
  const out: string[] = [];
  let buf = "";
  let inStr = false;
  let esc = false;
  for (const ch of inner) {
    if (esc) {
      buf += ch;
      esc = false;
      continue;
    }
    if (ch === "\\" && inStr) {
      buf += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      buf += ch;
      continue;
    }
    if (ch === "," && !inStr) {
      out.push(String(parseScalar(buf)));
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== "") out.push(String(parseScalar(buf)));
  return out;
}

interface SplitResult {
  fm: string;
  body: string;
}

function splitFrontmatter(raw: string): SplitResult {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!match) return { fm: "", body: raw };
  return { fm: match[1], body: match[2] };
}

function parseFrontmatter(fmText: string): EntityFrontmatter {
  const out: Record<string, unknown> = {
    title: "",
    type: "",
    tags: [],
    created: "",
    updated: "",
    quality: 0,
    status: "seedling",
    related: [] as Related[],
  };

  const lines = fmText.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Top-level keys start with no indentation.
    if (line.startsWith(" ") || line.startsWith("\t") || line.startsWith("-")) {
      i++;
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1);

    if (key === "tags") {
      out.tags = parseStringArray(rawVal);
      i++;
      continue;
    }

    if (key === "related") {
      const v = rawVal.trim();
      if (v === "[]" || v === "") {
        // Could be inline empty or block-style. Look ahead.
        if (v === "[]") {
          out.related = [];
          i++;
          continue;
        }
        const items: Related[] = [];
        i++;
        let current: Partial<Related> | null = null;
        while (i < lines.length) {
          const child = lines[i];
          if (
            child.trim() === "" ||
            (!child.startsWith(" ") && !child.startsWith("\t"))
          ) {
            break;
          }
          const t = child.trim();
          if (t.startsWith("- slug:")) {
            if (current?.slug) {
              items.push({
                slug: current.slug,
                type: (current.type ?? "related") as RelationType,
              });
            }
            current = {
              slug: String(parseScalar(t.slice("- slug:".length))),
            };
          } else if (t.startsWith("slug:") && current) {
            current.slug = String(parseScalar(t.slice("slug:".length)));
          } else if (t.startsWith("type:") && current) {
            current.type = parseScalar(t.slice("type:".length)) as RelationType;
          }
          i++;
        }
        if (current?.slug) {
          items.push({
            slug: current.slug,
            type: (current.type ?? "related") as RelationType,
          });
        }
        out.related = items;
        continue;
      }
      out.related = [];
      i++;
      continue;
    }

    // Inline string-array values.
    const v = rawVal.trim();
    if (v.startsWith("[") && v.endsWith("]")) {
      out[key] = parseStringArray(v);
    } else {
      out[key] = parseScalar(v);
    }
    i++;
  }

  return out as EntityFrontmatter;
}

// --- Validation -------------------------------------------------------------

export function validate(entity: Entity): void {
  const fm = entity.frontmatter;
  if (!fm.title || typeof fm.title !== "string") {
    throw new Error(`knowledge: missing or invalid 'title' for ${entity.slug}`);
  }
  if (typeof fm.quality !== "number" || fm.quality < 0 || fm.quality > 10) {
    throw new Error(`knowledge: 'quality' must be 0-10 for ${entity.slug}`);
  }
  if (!STATUSES.includes(fm.status)) {
    throw new Error(
      `knowledge: 'status' must be one of ${STATUSES.join("|")} for ${entity.slug}`
    );
  }
  if (!DOMAINS.includes(entity.domain)) {
    throw new Error(
      `knowledge: 'domain' must be one of ${DOMAINS.join("|")} (got ${entity.domain})`
    );
  }
  if (!Array.isArray(fm.tags) || fm.tags.some((t) => typeof t !== "string")) {
    throw new Error(`knowledge: 'tags' must be string[] for ${entity.slug}`);
  }
  if (!Array.isArray(fm.related)) {
    throw new Error(`knowledge: 'related' must be array for ${entity.slug}`);
  }
  for (const r of fm.related) {
    if (!r.slug || !RELATION_TYPES.includes(r.type)) {
      throw new Error(
        `knowledge: invalid related entry on ${entity.slug}: ${JSON.stringify(r)}`
      );
    }
  }
}

// --- Serialize / parse ------------------------------------------------------

export function serialize(entity: Entity): string {
  validate(entity);
  const fmText = emitFrontmatter(entity.frontmatter);
  const body = entity.body.endsWith("\n") ? entity.body : `${entity.body}\n`;
  return `${fmText}\n\n${body}`;
}

export function parse(domain: Domain, slug: string, raw: string): Entity {
  const { fm, body } = splitFrontmatter(raw);
  const frontmatter = parseFrontmatter(fm);
  return { domain, slug, frontmatter, body: body.replace(/^\n+/, "") };
}

// --- Filesystem -------------------------------------------------------------

function domainDir(domain: Domain, rootDir?: string): string {
  if (rootDir) {
    const d = resolve(rootDir, domain);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
    return d;
  }
  return ensureDir(resolve(paths.knowledge(), domain));
}

/** @lintignore — consumed by Phase 2 graph layer (needs path-per-slug to read files) */
export function entityPath(domain: Domain, slug: string, rootDir?: string): string {
  return resolve(domainDir(domain, rootDir), `${slug}.md`);
}

export function exists(domain: Domain, slug: string, rootDir?: string): boolean {
  return existsSync(entityPath(domain, slug, rootDir));
}

export function save(entity: Entity, rootDir?: string): void {
  const p = entityPath(entity.domain, entity.slug, rootDir);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, serialize(entity), "utf-8");
  renameSync(tmp, p);
}

export function load(domain: Domain, slug: string, rootDir?: string): Entity | null {
  const p = entityPath(domain, slug, rootDir);
  if (!existsSync(p)) return null;
  return parse(domain, slug, readFileSync(p, "utf-8"));
}

export function list(domain?: Domain, rootDir?: string): Entity[] {
  const target = domain ? [domain] : DOMAINS;
  const out: Entity[] = [];
  for (const d of target) {
    const dir = domainDir(d, rootDir);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".md") || entry.startsWith("_")) continue;
      const slug = entry.slice(0, -3);
      const e = load(d, slug, rootDir);
      if (e) out.push(e);
    }
  }
  return out;
}

// --- Create / get -----------------------------------------------------------

export interface CreateInput {
  domain: Domain;
  name: string;
  type?: string;
  tags?: string[];
  quality?: number;
  status?: Status;
  related?: Related[];
  body?: string;
  extra?: Record<string, unknown>;
}

/**
 * Idempotent: if an entity already exists at the slug derived from `name`,
 * return it untouched. Otherwise create a new file with sensible defaults
 * (quality 5, status "seedling", today's ISO timestamps).
 *
 * Merging new attributes into an existing entity is intentionally NOT here —
 * that's Phase 3 (extract-entities rewire). Keeping this idempotent makes
 * Phase 1 a safe storage primitive.
 */
export function getOrCreate(input: CreateInput, rootDir?: string): Entity {
  const slug = slugify(input.name);
  if (!slug) {
    throw new Error(`knowledge: cannot derive slug from name "${input.name}"`);
  }
  const existing = load(input.domain, slug, rootDir);
  if (existing) return existing;

  const now = new Date().toISOString();
  const fm: EntityFrontmatter = {
    title: input.name,
    type: input.type ?? DEFAULT_TYPE_BY_DOMAIN[input.domain],
    tags: input.tags ?? [],
    created: now,
    updated: now,
    quality: input.quality ?? 5,
    status: input.status ?? "seedling",
    related: input.related ?? [],
    ...(input.extra ?? {}),
  };
  const entity: Entity = {
    domain: input.domain,
    slug,
    frontmatter: fm,
    body: input.body ?? "",
  };
  save(entity, rootDir);
  return entity;
}

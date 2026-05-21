/**
 * pal cli knowledge — query and manage the knowledge store.
 *
 * Thin presentation layer over src/tools/knowledge/{lib,graph}.ts. Owns
 * formatting + argv parsing only; all entity logic lives in the tools.
 *
 * Subcommands:
 *   search <query>                Substring search across title/tags/body
 *   graph <slug> [--hops N]       BFS traversal from a slug (default 2 hops)
 *   stats                         Counts, hubs, isolated nodes
 *   hubs                          Top 10 most-connected entities
 *   find <tag>                    Entities tagged with <tag>
 *   show <slug>                   Print one entity (frontmatter + body)
 *   add <domain> <name>           Create entity (interactive unless flags given)
 *     --tags ai,research          Comma-separated tags
 *     --related slug:type         Repeatable; type ∈ RELATION_TYPES
 *     --quality 0-10
 *     --status seedling|budding|evergreen
 *     --type <subtype>            Free-form sub-type (default by domain)
 *   ls [domain]                   List entities, optionally by one domain
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import * as clack from "@clack/prompts";
import { buildGraph, resolveSlug, stats, traverse } from "../tools/knowledge/graph";
import {
  type CompanyInput,
  ingestEntities,
  type PersonInput,
} from "../tools/knowledge/ingest";
import {
  DOMAINS,
  type Domain,
  type Entity,
  getOrCreate,
  list,
  load,
  RELATION_TYPES,
  type Related,
  type RelationType,
  STATUSES,
  type Status,
} from "../tools/knowledge/lib";

// ── Dispatcher ─────────────────────────────────────────────────────

export async function runKnowledge(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "search":
      return cmdSearch(rest);
    case "graph":
      return cmdGraph(rest);
    case "stats":
      return cmdStats();
    case "hubs":
      return cmdHubs();
    case "find":
      return cmdFind(rest);
    case "show":
      return cmdShow(rest);
    case "add":
      return cmdAdd(rest);
    case "ls":
      return cmdLs(rest);
    case "ingest":
      return cmdIngest(rest);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      showHelp();
      return 0;
    default:
      console.error(`Unknown subcommand: ${sub}\n`);
      showHelp();
      return 1;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`
  Usage:
    pal cli knowledge <subcommand> [args]

  Subcommands:
    search <query>             Substring search across title, tags, body
    graph <slug> [--hops N]    BFS traversal from a slug (default 2 hops)
    stats                      Counts, hubs, isolated nodes
    hubs                       Top 10 most-connected entities
    find <tag>                 Entities tagged with <tag>
    show <slug>                Print one entity (frontmatter + body)
    add <domain> <name>        Create entity (interactive unless flags given)
      --tags ai,research            Comma-separated tags
      --related slug:type           Typed relation (repeatable)
      --quality 0-10                Default 5
      --status seedling|budding|evergreen   Default seedling
      --type <subtype>              Free-form sub-type
    ls [domain]                List entities (optionally by one domain)
    ingest [--file F]          Upsert JSON from stdin (or --file)
      --source <id>                 Provenance tag (default "manual")

  Domains: People, Companies, Ideas, Research
  Relation types: ${RELATION_TYPES.join(", ")}
`);
}

function isDomain(s: string): s is Domain {
  return (DOMAINS as readonly string[]).includes(s);
}

function isStatus(s: string): s is Status {
  return (STATUSES as readonly string[]).includes(s);
}

function isRelationType(s: string): s is RelationType {
  return (RELATION_TYPES as readonly string[]).includes(s);
}

function shortLine(entity: Entity, extra?: string): string {
  const tags = entity.frontmatter.tags.length
    ? ` [${entity.frontmatter.tags.join(", ")}]`
    : "";
  const tail = extra ? `  ${extra}` : "";
  return `  ${entity.domain}/${entity.slug} — ${entity.frontmatter.title}${tags}${tail}`;
}

// ── search ─────────────────────────────────────────────────────────

interface SearchHit {
  entity: Entity;
  score: number;
}

function scoreEntity(entity: Entity, q: string): number {
  const lower = q.toLowerCase();
  let score = 0;
  if (entity.slug.includes(lower)) score += 5;
  if (entity.frontmatter.title.toLowerCase().includes(lower)) score += 4;
  for (const tag of entity.frontmatter.tags) {
    if (tag.toLowerCase().includes(lower)) score += 2;
  }
  // Count body occurrences (cap at 10 to avoid runaway weighting on huge bodies)
  const body = entity.body.toLowerCase();
  let pos = body.indexOf(lower);
  let bodyHits = 0;
  while (pos !== -1 && bodyHits < 10) {
    bodyHits++;
    pos = body.indexOf(lower, pos + lower.length);
  }
  score += bodyHits;
  return score;
}

function cmdSearch(args: string[]): number {
  const q = args[0];
  if (!q) {
    console.error("Usage: pal cli knowledge search <query>");
    return 1;
  }
  const hits: SearchHit[] = [];
  for (const e of list()) {
    const s = scoreEntity(e, q);
    if (s > 0) hits.push({ entity: e, score: s });
  }
  hits.sort((a, b) => b.score - a.score || a.entity.slug.localeCompare(b.entity.slug));
  if (hits.length === 0) {
    console.log(`No matches for "${q}".`);
    return 0;
  }
  console.log(`\n🔎 ${hits.length} match${hits.length === 1 ? "" : "es"} for "${q}":\n`);
  for (const h of hits) console.log(shortLine(h.entity, `(score: ${h.score})`));
  console.log();
  return 0;
}

// ── graph ──────────────────────────────────────────────────────────

function cmdGraph(args: string[]): number {
  const { values, positionals } = parseArgs({
    args,
    options: { hops: { type: "string" } },
    allowPositionals: true,
    strict: false,
  });
  const query = positionals[0];
  if (!query) {
    console.error("Usage: pal cli knowledge graph <slug> [--hops N]");
    return 1;
  }
  const hops = values.hops ? Number(values.hops) : 2;
  if (!Number.isInteger(hops) || hops < 1) {
    console.error("--hops must be a positive integer");
    return 1;
  }
  const g = buildGraph();
  const slug = resolveSlug(g, query);
  if (!slug) {
    console.error(`No entity matching "${query}".`);
    return 1;
  }
  const start = g.nodes.get(slug);
  if (!start) {
    console.error(`Slug "${slug}" resolved but not in graph.`);
    return 1;
  }
  const trail = traverse(g, slug, hops);
  console.log(`\n🗺  ${start.domain}/${slug} — "${start.title}"`);
  console.log(`   ${hops} hop${hops === 1 ? "" : "s"} · ${trail.length - 1} reachable\n`);
  const byHop = new Map<number, typeof trail>();
  for (const t of trail) {
    if (t.hop === 0) continue;
    const bucket = byHop.get(t.hop);
    if (bucket) bucket.push(t);
    else byHop.set(t.hop, [t]);
  }
  for (const [hop, items] of [...byHop.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  hop ${hop}:`);
    for (const t of items) {
      const edge = t.viaEdge;
      const labelSuffix = edge?.label ? `:${edge.label}` : "";
      const via = edge ? `via ${edge.edgeType}${labelSuffix} (w=${edge.weight})` : "";
      console.log(`    → ${t.node.domain}/${t.node.slug} — "${t.node.title}"  ${via}`);
    }
  }
  console.log();
  return 0;
}

// ── stats ──────────────────────────────────────────────────────────

function cmdStats(): number {
  const g = buildGraph();
  const s = stats(g);
  console.log(`\n📊 Knowledge stats\n`);
  console.log(`  Nodes: ${s.nodes}`);
  for (const d of DOMAINS) {
    console.log(`    ${d.padEnd(10)} ${s.nodesByDomain[d]}`);
  }
  console.log(`  Edges: ${s.edges}`);
  console.log(`    related:  ${s.edgesByType.related}`);
  console.log(`    wikilink: ${s.edgesByType.wikilink}`);
  console.log(`    tag:      ${s.edgesByType.tag}`);
  console.log(`  Avg connections per node: ${s.avgConnections}`);
  console.log(`  Isolated nodes: ${s.isolatedNodes}`);
  if (s.mostConnected) {
    console.log(`  Most connected: ${s.mostConnected.slug} (${s.mostConnected.count})`);
  }
  console.log();
  return 0;
}

// ── hubs ───────────────────────────────────────────────────────────

function cmdHubs(): number {
  const g = buildGraph();
  const counts = new Map<string, Set<string>>();
  for (const edge of g.edges) {
    const fromSet = counts.get(edge.from) ?? new Set<string>();
    fromSet.add(edge.to);
    counts.set(edge.from, fromSet);
    const toSet = counts.get(edge.to) ?? new Set<string>();
    toSet.add(edge.from);
    counts.set(edge.to, toSet);
  }
  const ranked = [...counts.entries()]
    .map(([slug, set]) => ({ slug, count: set.size }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
    .slice(0, 10);
  console.log(`\n🔗 Top hubs\n`);
  if (ranked.length === 0) {
    console.log("  (no connected nodes)\n");
    return 0;
  }
  for (const [i, r] of ranked.entries()) {
    const node = g.nodes.get(r.slug);
    const label = node ? `${node.domain}/${r.slug} — "${node.title}"` : r.slug;
    console.log(`  ${String(i + 1).padStart(2)}. ${label}  (${r.count} connections)`);
  }
  console.log();
  return 0;
}

// ── find ───────────────────────────────────────────────────────────

function cmdFind(args: string[]): number {
  const tag = args[0]?.toLowerCase();
  if (!tag) {
    console.error("Usage: pal cli knowledge find <tag>");
    return 1;
  }
  // Accept both the bare tag and the topic-prefixed form so users don't
  // need to know which kind a given concept was stored as.
  const prefixedTag = tag.startsWith("topic:") ? tag : `topic:${tag}`;
  const matches = list().filter((e) =>
    e.frontmatter.tags.some((t) => {
      const lower = t.toLowerCase();
      return lower === tag || lower === prefixedTag;
    })
  );
  console.log(
    `\n🏷  ${matches.length} entit${matches.length === 1 ? "y" : "ies"} tagged "${tag}":\n`
  );
  for (const e of matches.sort(
    (a, b) => a.domain.localeCompare(b.domain) || a.slug.localeCompare(b.slug)
  )) {
    console.log(shortLine(e));
  }
  console.log();
  return 0;
}

// ── show ───────────────────────────────────────────────────────────

function cmdShow(args: string[]): number {
  const query = args[0];
  if (!query) {
    console.error("Usage: pal cli knowledge show <slug>");
    return 1;
  }
  const g = buildGraph();
  const slug = resolveSlug(g, query);
  if (!slug) {
    console.error(`No entity matching "${query}".`);
    return 1;
  }
  const node = g.nodes.get(slug);
  if (!node) {
    console.error(`Slug "${slug}" resolved but not in graph.`);
    return 1;
  }
  const entity = load(node.domain, slug);
  if (!entity) {
    console.error(`File missing for ${node.domain}/${slug}.`);
    return 1;
  }
  console.log(`\n${entity.domain}/${entity.slug}`);
  console.log("─".repeat(50));
  for (const [k, v] of Object.entries(entity.frontmatter)) {
    if (k === "related") continue;
    console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
  if (entity.frontmatter.related.length > 0) {
    console.log(`  related:`);
    for (const r of entity.frontmatter.related) {
      const target = g.nodes.get(r.slug);
      const tail = target ? `  — "${target.title}"` : "";
      console.log(`    - ${r.type} → ${r.slug}${tail}`);
    }
  }
  if (entity.body.trim()) {
    console.log(`\n${entity.body.trim()}`);
  }
  console.log();
  return 0;
}

// ── add ────────────────────────────────────────────────────────────

interface AddFlags {
  tags: string[];
  related: Related[];
  quality?: number;
  status?: Status;
  type?: string;
  body?: string;
}

function parseRelatedFlag(value: string): Related {
  const [slug, type] = value.split(":");
  if (!slug || !type) {
    throw new Error(`--related must be slug:type, got "${value}"`);
  }
  if (!isRelationType(type)) {
    throw new Error(
      `--related type must be one of: ${RELATION_TYPES.join(", ")} (got "${type}")`
    );
  }
  return { slug, type };
}

function parseAddFlags(args: string[]): AddFlags {
  const { values } = parseArgs({
    args,
    options: {
      tags: { type: "string" },
      related: { type: "string", multiple: true },
      quality: { type: "string" },
      status: { type: "string" },
      type: { type: "string" },
      body: { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });
  const tags = values.tags
    ? String(values.tags)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const related = ((values.related as string[] | undefined) ?? []).map(parseRelatedFlag);
  const quality = values.quality != null ? Number(values.quality) : undefined;
  if (quality != null && (!Number.isInteger(quality) || quality < 0 || quality > 10)) {
    throw new Error("--quality must be an integer 0-10");
  }
  const status = values.status as string | undefined;
  if (status && !isStatus(status)) {
    throw new Error(`--status must be one of: ${STATUSES.join(", ")}`);
  }
  return {
    tags,
    related,
    quality,
    status: status as Status | undefined,
    type: values.type as string | undefined,
    body: values.body as string | undefined,
  };
}

async function cmdAdd(args: string[]): Promise<number> {
  // First two positionals: domain, name.
  const positional = args.filter((a) => !a.startsWith("--"));
  const domainStr = positional[0];
  const name = positional[1];
  if (!domainStr || !isDomain(domainStr)) {
    console.error(`Usage: pal cli knowledge add <${DOMAINS.join("|")}> <name> [flags]`);
    return 1;
  }
  if (!name) {
    console.error("Missing <name>");
    return 1;
  }

  const flagArgs = args.slice(args.indexOf(name) + 1);
  const hasAnyFlag = flagArgs.some((a) => a.startsWith("--"));
  let flags: AddFlags;
  try {
    flags = parseAddFlags(flagArgs);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }

  // Interactive mode only when no flags and we have a TTY.
  if (!hasAnyFlag && process.stdin.isTTY) {
    const enriched = await runInteractiveAdd(flags);
    if (enriched === null) return 1;
    flags = enriched;
  }

  const entity = getOrCreate({
    domain: domainStr,
    name,
    tags: flags.tags,
    related: flags.related,
    quality: flags.quality,
    status: flags.status,
    type: flags.type,
    body: flags.body,
  });
  console.log(`✓ ${entity.domain}/${entity.slug} — "${entity.frontmatter.title}"`);
  return 0;
}

async function runInteractiveAdd(prefilled: AddFlags): Promise<AddFlags | null> {
  clack.intro("Add knowledge entry");
  const tagsInput = await clack.text({
    message: "Tags (comma-separated, optional):",
    placeholder: "ai, research",
  });
  if (clack.isCancel(tagsInput)) {
    clack.cancel("Cancelled");
    return null;
  }
  const tags = String(tagsInput || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const statusSel = await clack.select({
    message: "Status:",
    options: STATUSES.map((s) => ({ value: s, label: s })),
    initialValue: prefilled.status ?? "seedling",
  });
  if (clack.isCancel(statusSel)) {
    clack.cancel("Cancelled");
    return null;
  }

  const qualityInput = await clack.text({
    message: "Quality (0-10):",
    placeholder: "5",
    initialValue: String(prefilled.quality ?? 5),
  });
  if (clack.isCancel(qualityInput)) {
    clack.cancel("Cancelled");
    return null;
  }

  clack.outro("Saved");
  return {
    ...prefilled,
    tags: prefilled.tags.length ? prefilled.tags : tags,
    status: statusSel as Status,
    quality: Number(qualityInput),
  };
}

// ── ls ─────────────────────────────────────────────────────────────

function cmdLs(args: string[]): number {
  const domainArg = args[0];
  if (domainArg && !isDomain(domainArg)) {
    console.error(`Domain must be one of: ${DOMAINS.join(", ")}`);
    return 1;
  }
  const target = domainArg ? (domainArg as Domain) : undefined;
  const entries = list(target).sort(
    (a, b) => a.domain.localeCompare(b.domain) || a.slug.localeCompare(b.slug)
  );
  const noun = entries.length === 1 ? "entity" : "entities";
  const scope = target ? ` in ${target}` : "";
  console.log(`\n📁 ${entries.length} ${noun}${scope}\n`);
  for (const e of entries) console.log(shortLine(e));
  console.log();
  return 0;
}

// ── ingest ─────────────────────────────────────────────────────────

interface IngestPayload {
  people?: PersonInput[];
  companies?: CompanyInput[];
}

async function readIngestInput(file: string | undefined): Promise<string | null> {
  if (file) return readFileSync(file, "utf-8");
  if (process.stdin.isTTY) return null;
  return await Bun.stdin.text();
}

async function cmdIngest(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      source: { type: "string", short: "s", default: "manual" },
      file: { type: "string", short: "f" },
    },
    strict: true,
  });

  const sourceId = values.source ?? "manual";
  const raw = await readIngestInput(values.file);

  if (raw === null || !raw.trim()) {
    console.error(
      "Usage: echo '<JSON>' | pal cli knowledge ingest --source <id>\n" +
        "   or: pal cli knowledge ingest --file <path> --source <id>"
    );
    return 1;
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

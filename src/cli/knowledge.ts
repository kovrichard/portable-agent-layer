/**
 * pal cli knowledge — query and manage the knowledge store.
 *
 * Thin presentation layer over src/tools/knowledge/{lib,graph}.ts. Owns
 * formatting + argv parsing only; all entity logic lives in the tools.
 */

import { buildGraph, resolveSlug, stats, traverse } from "../tools/knowledge/graph";
import {
  DOMAINS,
  type Domain,
  type Entity,
  list,
  load,
  RELATION_TYPES,
  STATUSES,
} from "../tools/knowledge/lib";
import { group, leaf, runCommand, UsageError } from "../tools/lib/command";
import { cmdAdd, parseAddFlags } from "./knowledge-add";
import { cmdIngest } from "./knowledge-ingest";
import { researchCommand } from "./knowledge-research";
import { reviewCommand } from "./knowledge-review";

const VOCABULARY = `Domains: ${DOMAINS.join(", ")}
Relation types: ${RELATION_TYPES.join(", ")}`;

export const knowledgeCommand = group({
  summary: "Query and manage the knowledge store",
  commands: {
    search: leaf({
      summary: "Substring search across title, tags, body",
      args: "<query>",
      run: ({ positionals }) => cmdSearch(positionals[0]),
    }),
    graph: leaf({
      summary: "BFS traversal from a slug (default 2 hops)",
      args: "<slug>",
      options: {
        hops: { type: "string", value: "<n>", description: "Hops to follow (default 2)" },
      },
      run: ({ positionals, values }) => cmdGraph(positionals[0], parseHops(values.hops)),
    }),
    stats: leaf({ summary: "Counts, hubs, isolated nodes", run: cmdStats }),
    hubs: leaf({ summary: "Top 10 most-connected entities", run: cmdHubs }),
    find: leaf({
      summary: "Entities tagged with <tag>",
      args: "<tag>",
      run: ({ positionals }) => cmdFind(positionals[0]),
    }),
    show: leaf({
      summary: "Print one entity (frontmatter + body)",
      args: "<slug>",
      run: ({ positionals }) => cmdShow(positionals[0]),
    }),
    add: leaf({
      summary: "Create an entity (interactive unless flags are given)",
      args: "<domain> <name>",
      options: {
        tags: { type: "string", value: "<a,b>", description: "Comma-separated tags" },
        related: {
          type: "string",
          multiple: true,
          value: "<slug:type>",
          description: "Typed relation (repeatable)",
        },
        quality: { type: "string", value: "<0-10>", description: "Default 5" },
        status: {
          type: "string",
          value: `<${STATUSES.join("|")}>`,
          description: "Default seedling",
        },
        type: { type: "string", value: "<subtype>", description: "Free-form sub-type" },
        body: { type: "string", value: "<text>", description: "Markdown body" },
      },
      details: VOCABULARY,
      run: ({ positionals, values }) =>
        cmdAdd(
          parseDomain(positionals[0]),
          positionals[1],
          parseAddFlags(values),
          Object.keys(values).length > 0
        ),
    }),
    ls: leaf({
      summary: "List entities, optionally by one domain",
      args: "[domain]",
      details: VOCABULARY,
      run: ({ positionals }) =>
        cmdLs(positionals[0] === undefined ? undefined : parseDomain(positionals[0])),
    }),
    ingest: leaf({
      summary: "Upsert people and companies from JSON on stdin (or --file)",
      options: {
        source: {
          type: "string",
          short: "s",
          value: "<id>",
          description: 'Provenance tag (default "manual")',
        },
        file: {
          type: "string",
          short: "f",
          value: "<path>",
          description: "Read the JSON from a file instead of stdin",
        },
      },
      run: ({ values }) => cmdIngest(values.source ?? "manual", values.file),
    }),
    research: researchCommand,
    review: reviewCommand,
  },
  details: VOCABULARY,
});

export function runKnowledge(args: string[]): Promise<number> {
  return runCommand(knowledgeCommand, args, ["pal", "cli", "knowledge"]);
}

function isDomain(s: string): s is Domain {
  return (DOMAINS as readonly string[]).includes(s);
}

function parseDomain(value: string): Domain {
  if (!isDomain(value))
    throw new UsageError(`domain must be one of: ${DOMAINS.join(", ")}`);

  return value;
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

/**
 * Strip PAL-emitted source markup lines from a body before search scoring.
 * Keeps the markers on disk (for provenance + idempotency) but excludes
 * them from the search corpus — otherwise source IDs leak into results
 * and every entity from a batch matches substrings of the source ID.
 * ISC-22.
 */
const PAL_HEADING_RE = /^### \d{4}-\d{2}-\d{2} — /;
function bodyForSearch(body: string): string {
  return body
    .split("\n")
    .filter((line) => !PAL_HEADING_RE.test(line) && !line.startsWith("<!-- src:"))
    .join("\n");
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
  const body = bodyForSearch(entity.body).toLowerCase();
  let pos = body.indexOf(lower);
  let bodyHits = 0;

  while (pos !== -1 && bodyHits < 10) {
    bodyHits++;
    pos = body.indexOf(lower, pos + lower.length);
  }

  score += bodyHits;

  return score;
}

function cmdSearch(q: string): number {
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

function parseHops(value: string | undefined): number {
  const hops = value === undefined ? 2 : Number(value);
  if (!Number.isInteger(hops) || hops < 1) {
    throw new UsageError("--hops must be a positive integer");
  }

  return hops;
}

function cmdGraph(query: string, hops: number): number {
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
  const byHop = groupByHop(trail);

  for (const [hop, items] of [...byHop.entries()].sort((a, b) => a[0] - b[0])) {
    printHop(hop, items);
  }

  console.log();

  return 0;
}

type TrailStep = ReturnType<typeof traverse>[number];

function groupByHop(trail: TrailStep[]): Map<number, TrailStep[]> {
  const byHop = new Map<number, TrailStep[]>();

  for (const t of trail) {
    if (t.hop === 0) continue;
    const bucket = byHop.get(t.hop);
    if (bucket) bucket.push(t);
    else byHop.set(t.hop, [t]);
  }

  return byHop;
}

function printHop(hop: number, items: TrailStep[]): void {
  console.log(`  hop ${hop}:`);

  for (const t of items) {
    const edge = t.viaEdge;
    const labelSuffix = edge?.label ? `:${edge.label}` : "";
    const via = edge ? `via ${edge.edgeType}${labelSuffix} (w=${edge.weight})` : "";
    console.log(`    → ${t.node.domain}/${t.node.slug} — "${t.node.title}"  ${via}`);
  }
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

function cmdFind(rawTag: string): number {
  const tag = rawTag.toLowerCase();
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

function cmdShow(query: string): number {
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

// ── ls ─────────────────────────────────────────────────────────────

function cmdLs(target: Domain | undefined): number {
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

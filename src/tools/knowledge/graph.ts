/**
 * Knowledge graph — associative navigation over the markdown-per-entity store.
 *
 * Builds an in-memory graph from the files written by ./lib.ts. Three edge
 * types, weighted, no persistence:
 *
 *   related   weight 5   typed pointer from frontmatter `related:` array
 *   wikilink  weight 3   [[slug]] reference anywhere in the body
 *   tag       weight 1   two entities share a tag (bidirectional, capped at
 *                        50 nodes per tag to prevent O(n²) on popular tags)
 *
 * Ported from PAI's KnowledgeGraph.ts. Computed fresh on every call — no
 * graph state lives on disk.
 */

import { type Domain, type Entity, list } from "./lib";

// --- Constants --------------------------------------------------------------

const WEIGHT_RELATED = 5;
const WEIGHT_WIKILINK = 3;
const WEIGHT_TAG = 1;
const TAG_GROUP_CAP = 50;
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

// --- Types ------------------------------------------------------------------

/** @lintignore — consumed by Phase 4 query CLI (renders nodes by domain/title) */
export interface GraphNode {
  slug: string;
  domain: Domain;
  title: string;
  type: string;
  tags: string[];
}

/** @lintignore — consumed by Phase 4 query CLI for edge-type filtering */
export type EdgeType = "related" | "wikilink" | "tag";

export interface GraphEdge {
  from: string;
  to: string;
  weight: number;
  edgeType: EdgeType;
  label?: string;
}

export interface KnowledgeGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  /** Outgoing edges keyed by `edge.from` slug. */
  adjacency: Map<string, GraphEdge[]>;
  /**
   * Incoming edges keyed by `edge.to` slug. Lets BFS walk against edge
   * direction (e.g. a company reached from its referencing people). The
   * GraphEdge objects are SHARED with `adjacency` — direction info is
   * preserved, not mirrored into reversed copies.
   */
  reverseAdjacency: Map<string, GraphEdge[]>;
}

export interface TraversalNode {
  node: GraphNode;
  hop: number;
  cumulativeWeight: number;
  viaEdge?: GraphEdge;
}

export interface GraphStats {
  nodes: number;
  nodesByDomain: Record<Domain, number>;
  edges: number;
  edgesByType: Record<EdgeType, number>;
  avgConnections: number;
  isolatedNodes: number;
  mostConnected: { slug: string; count: number } | null;
}

// --- Wikilink extraction ----------------------------------------------------

/**
 * Extract wikilink targets from a body string.
 *
 * - `[[slug]]` → slug
 * - `[[domain/slug]]` → slug (drop the path prefix, match PAI)
 * - `[[slug|display text]]` → slug
 * - leading-underscore slugs (`_index`, `_log`) are filtered out
 */
export function extractWikilinks(body: string): string[] {
  const out: string[] = [];
  const matches = body.matchAll(WIKILINK_REGEX);
  for (const m of matches) {
    const raw = m[1].trim();
    const slug = raw.includes("/") ? (raw.split("/").pop() ?? raw) : raw;
    if (slug && !slug.startsWith("_")) out.push(slug);
  }
  return out;
}

// --- Graph construction -----------------------------------------------------

function pushEdge(graph: KnowledgeGraph, edge: GraphEdge, bidirectional = false): void {
  graph.edges.push(edge);
  const adj = graph.adjacency.get(edge.from);
  if (adj) {
    adj.push(edge);
  } else {
    graph.adjacency.set(edge.from, [edge]);
  }
  // Mirror into reverse adjacency so traverse can walk against direction.
  // Same edge object — no copies, no direction info lost.
  const radj = graph.reverseAdjacency.get(edge.to);
  if (radj) {
    radj.push(edge);
  } else {
    graph.reverseAdjacency.set(edge.to, [edge]);
  }
  if (!bidirectional) return;
  const back: GraphEdge = {
    from: edge.to,
    to: edge.from,
    weight: edge.weight,
    edgeType: edge.edgeType,
    label: edge.label,
  };
  graph.edges.push(back);
  const backAdj = graph.adjacency.get(back.from);
  if (backAdj) {
    backAdj.push(back);
  } else {
    graph.adjacency.set(back.from, [back]);
  }
  const backRadj = graph.reverseAdjacency.get(back.to);
  if (backRadj) {
    backRadj.push(back);
  } else {
    graph.reverseAdjacency.set(back.to, [back]);
  }
}

function buildNodes(entities: Entity[]): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>();
  for (const e of entities) {
    nodes.set(e.slug, {
      slug: e.slug,
      domain: e.domain,
      title: e.frontmatter.title,
      type: e.frontmatter.type,
      tags: e.frontmatter.tags.map((t) => t.toLowerCase()),
    });
  }
  return nodes;
}

function buildExplicitEdges(graph: KnowledgeGraph, entities: Entity[]): void {
  for (const e of entities) {
    // Wikilinks
    const wikilinks = extractWikilinks(e.body);
    for (const target of wikilinks) {
      if (!graph.nodes.has(target) || target === e.slug) continue;
      pushEdge(graph, {
        from: e.slug,
        to: target,
        weight: WEIGHT_WIKILINK,
        edgeType: "wikilink",
      });
    }

    // Related (typed)
    for (const rel of e.frontmatter.related) {
      if (!graph.nodes.has(rel.slug) || rel.slug === e.slug) continue;
      pushEdge(graph, {
        from: e.slug,
        to: rel.slug,
        weight: WEIGHT_RELATED,
        edgeType: "related",
        label: rel.type,
      });
    }
  }
}

function buildTagEdges(graph: KnowledgeGraph): void {
  const tagIndex = new Map<string, string[]>();
  for (const node of graph.nodes.values()) {
    for (const tag of node.tags) {
      const list = tagIndex.get(tag);
      if (list) list.push(node.slug);
      else tagIndex.set(tag, [node.slug]);
    }
  }

  const seen = new Set<string>();
  for (const [tag, slugs] of tagIndex) {
    if (slugs.length < 2) continue;
    // Deterministic ordering before capping so behavior doesn't depend on
    // `list()` iteration order across platforms.
    const sorted = [...slugs].sort();
    const group = sorted.length > TAG_GROUP_CAP ? sorted.slice(0, TAG_GROUP_CAP) : sorted;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const key = `${a}|${b}|${tag}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pushEdge(
          graph,
          {
            from: a,
            to: b,
            weight: WEIGHT_TAG,
            edgeType: "tag",
            label: tag,
          },
          true
        );
      }
    }
  }
}

export function buildGraph(rootDir?: string): KnowledgeGraph {
  const entities = list(undefined, rootDir);
  const nodes = buildNodes(entities);
  const graph: KnowledgeGraph = {
    nodes,
    edges: [],
    adjacency: new Map(),
    reverseAdjacency: new Map(),
  };
  buildExplicitEdges(graph, entities);
  buildTagEdges(graph);
  return graph;
}

// --- Slug resolution --------------------------------------------------------

/**
 * Resolve a user query to a slug.
 *   exact match            → that slug
 *   one substring match    → that slug
 *   multiple substring     → shortest (most specific) wins
 *   none                   → null
 */
export function resolveSlug(graph: KnowledgeGraph, query: string): string | null {
  const q = query.toLowerCase();
  if (graph.nodes.has(q)) return q;

  const candidates: string[] = [];
  for (const slug of graph.nodes.keys()) {
    if (slug.includes(q)) candidates.push(slug);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return candidates[0];
}

// --- Traversal --------------------------------------------------------------

/**
 * BFS from `startSlug` up to `maxHops`. For each frontier node, we pick the
 * highest-weight edge per target so traversal favors `related` (5) over
 * `wikilink` (3) over `tag` (1). Visited tracking prevents re-enqueueing.
 */
export function traverse(
  graph: KnowledgeGraph,
  startSlug: string,
  maxHops: number
): TraversalNode[] {
  const out: TraversalNode[] = [];
  const start = graph.nodes.get(startSlug);
  if (!start) return out;

  const visited = new Set<string>([startSlug]);
  type QueueEntry = {
    slug: string;
    hop: number;
    cumWeight: number;
    via?: GraphEdge;
  };
  const queue: QueueEntry[] = [{ slug: startSlug, hop: 0, cumWeight: 0 }];

  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) break;
    const node = graph.nodes.get(entry.slug);
    if (!node) continue;
    out.push({
      node,
      hop: entry.hop,
      cumulativeWeight: entry.cumWeight,
      viaEdge: entry.via,
    });
    if (entry.hop >= maxHops) continue;

    const outgoing = graph.adjacency.get(entry.slug) ?? [];
    const incoming = graph.reverseAdjacency.get(entry.slug) ?? [];
    const bestPerTarget = new Map<string, GraphEdge>();
    for (const edge of outgoing) {
      if (visited.has(edge.to)) continue;
      const existing = bestPerTarget.get(edge.to);
      if (!existing || edge.weight > existing.weight) {
        bestPerTarget.set(edge.to, edge);
      }
    }
    for (const edge of incoming) {
      // edge.to is the current node; edge.from is the "other" endpoint.
      const other = edge.from;
      if (visited.has(other) || other === entry.slug) continue;
      const existing = bestPerTarget.get(other);
      if (!existing || edge.weight > existing.weight) {
        bestPerTarget.set(other, edge);
      }
    }

    const sorted = [...bestPerTarget.entries()].sort(
      (a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0])
    );
    for (const [target, edge] of sorted) {
      if (visited.has(target)) continue;
      visited.add(target);
      queue.push({
        slug: target,
        hop: entry.hop + 1,
        cumWeight: entry.cumWeight + edge.weight,
        via: edge,
      });
    }
  }

  return out;
}

// --- Stats ------------------------------------------------------------------

export function stats(graph: KnowledgeGraph): GraphStats {
  const nodesByDomain: Record<Domain, number> = {
    People: 0,
    Companies: 0,
    Ideas: 0,
    Research: 0,
  };
  for (const node of graph.nodes.values()) {
    nodesByDomain[node.domain]++;
  }

  const edgesByType: Record<EdgeType, number> = {
    related: 0,
    wikilink: 0,
    tag: 0,
  };
  for (const edge of graph.edges) {
    edgesByType[edge.edgeType]++;
  }

  const connections = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const a = connections.get(edge.from) ?? new Set<string>();
    a.add(edge.to);
    connections.set(edge.from, a);
    const b = connections.get(edge.to) ?? new Set<string>();
    b.add(edge.from);
    connections.set(edge.to, b);
  }

  let isolated = 0;
  let mostConnected: { slug: string; count: number } | null = null;
  let totalConnCount = 0;
  for (const slug of graph.nodes.keys()) {
    const peers = connections.get(slug);
    const count = peers ? peers.size : 0;
    totalConnCount += count;
    if (count === 0) isolated++;
    if (!mostConnected || count > mostConnected.count) {
      mostConnected = { slug, count };
    }
  }

  const avg = graph.nodes.size > 0 ? totalConnCount / graph.nodes.size : 0;

  return {
    nodes: graph.nodes.size,
    nodesByDomain,
    edges: graph.edges.length,
    edgesByType,
    avgConnections: Math.round(avg * 10) / 10,
    isolatedNodes: isolated,
    mostConnected: mostConnected && mostConnected.count > 0 ? mostConnected : null,
  };
}

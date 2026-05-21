import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildGraph,
  extractWikilinks,
  type GraphEdge,
  resolveSlug,
  stats,
  traverse,
} from "../src/tools/knowledge/graph";
import { type Domain, getOrCreate, save } from "../src/tools/knowledge/lib";

const ROOT = resolve(import.meta.dir, "../.test-tmp/knowledge-graph");

function seed(args: {
  domain: Domain;
  name: string;
  tags?: string[];
  related?: Array<{
    slug: string;
    type:
      | "supports"
      | "contradicts"
      | "extends"
      | "part-of"
      | "instance-of"
      | "caused-by"
      | "preceded-by"
      | "related";
  }>;
  body?: string;
}): void {
  const entity = getOrCreate(
    {
      domain: args.domain,
      name: args.name,
      tags: args.tags ?? [],
      related: args.related ?? [],
      body: args.body ?? "",
    },
    ROOT
  );
  // getOrCreate writes; nothing more to do.
  if (!entity.slug) throw new Error("seed failed");
}

function fixture(): void {
  // 3 people, 2 companies. Mix of related, wikilink, tag edges.
  seed({
    domain: "Companies",
    name: "Acme Labs",
    tags: ["ai", "research"],
  });
  seed({
    domain: "Companies",
    name: "Beta Corp",
    tags: ["ai"],
  });
  seed({
    domain: "People",
    name: "Alice Example",
    tags: ["ai"],
    related: [{ slug: "acme-labs", type: "instance-of" }],
    body: "Alice collaborates with [[bob-example]] often.",
  });
  seed({
    domain: "People",
    name: "Bob Example",
    tags: ["ml"],
    related: [{ slug: "beta-corp", type: "instance-of" }],
    body: "See also [[acme-labs]].",
  });
  seed({
    domain: "People",
    name: "Carol Solo",
    tags: ["nlp"],
    // Isolated — no edges.
  });
}

beforeEach(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
});

// --- Wikilink extractor -----------------------------------------------------

describe("extractWikilinks", () => {
  test("plain slug", () => {
    expect(extractWikilinks("see [[foo]] for details")).toEqual(["foo"]);
  });

  test("multiple wikilinks", () => {
    expect(extractWikilinks("[[a]] and [[b]] and [[c]]")).toEqual(["a", "b", "c"]);
  });

  test("path prefix is stripped", () => {
    expect(extractWikilinks("see [[people/alice]]")).toEqual(["alice"]);
  });

  test("display-text pipe is stripped", () => {
    expect(extractWikilinks("see [[foo|the foo]]")).toEqual(["foo"]);
  });

  test("leading-underscore slugs filtered", () => {
    expect(extractWikilinks("[[_index]] and [[real]]")).toEqual(["real"]);
  });

  test("no wikilinks → empty", () => {
    expect(extractWikilinks("no links here")).toEqual([]);
  });
});

// --- buildGraph: nodes ------------------------------------------------------

describe("buildGraph — nodes", () => {
  test("registers all entities as nodes", () => {
    fixture();
    const g = buildGraph(ROOT);
    expect(g.nodes.size).toBe(5);
    expect(g.nodes.has("alice-example")).toBe(true);
    expect(g.nodes.has("carol-solo")).toBe(true);
  });

  test("node carries domain + tags", () => {
    fixture();
    const g = buildGraph(ROOT);
    const alice = g.nodes.get("alice-example");
    expect(alice?.domain).toBe("People");
    expect(alice?.tags).toEqual(["ai"]);
  });
});

// --- buildGraph: edges ------------------------------------------------------

describe("buildGraph — related edges (weight 5)", () => {
  test("typed related edge created", () => {
    fixture();
    const g = buildGraph(ROOT);
    const rel = g.edges.find(
      (e: GraphEdge) =>
        e.edgeType === "related" && e.from === "alice-example" && e.to === "acme-labs"
    );
    expect(rel).toBeDefined();
    expect(rel?.weight).toBe(5);
    expect(rel?.label).toBe("instance-of");
  });

  test("related edge to unknown slug is dropped", () => {
    seed({
      domain: "People",
      name: "Dangling",
      related: [{ slug: "ghost", type: "related" }],
    });
    const g = buildGraph(ROOT);
    const rel = g.edges.find(
      (e: GraphEdge) => e.edgeType === "related" && e.to === "ghost"
    );
    expect(rel).toBeUndefined();
  });
});

describe("buildGraph — wikilink edges (weight 3)", () => {
  test("body wikilink creates wikilink edge", () => {
    fixture();
    const g = buildGraph(ROOT);
    const wl = g.edges.find(
      (e: GraphEdge) =>
        e.edgeType === "wikilink" && e.from === "alice-example" && e.to === "bob-example"
    );
    expect(wl).toBeDefined();
    expect(wl?.weight).toBe(3);
  });

  test("wikilink to unknown slug dropped", () => {
    seed({
      domain: "People",
      name: "Dangling",
      body: "[[ghost]]",
    });
    const g = buildGraph(ROOT);
    const wl = g.edges.find(
      (e: GraphEdge) => e.edgeType === "wikilink" && e.to === "ghost"
    );
    expect(wl).toBeUndefined();
  });

  test("self-wikilink dropped", () => {
    seed({
      domain: "People",
      name: "Self Refer",
      body: "I am [[self-refer]] yes really",
    });
    const g = buildGraph(ROOT);
    const wl = g.edges.find(
      (e: GraphEdge) =>
        e.edgeType === "wikilink" && e.from === "self-refer" && e.to === "self-refer"
    );
    expect(wl).toBeUndefined();
  });
});

describe("buildGraph — tag edges (weight 1, bidirectional)", () => {
  test("shared tag creates bidirectional edges", () => {
    fixture();
    const g = buildGraph(ROOT);
    const ab = g.edges.find(
      (e: GraphEdge) =>
        e.edgeType === "tag" &&
        e.label === "ai" &&
        e.from === "acme-labs" &&
        e.to === "alice-example"
    );
    const ba = g.edges.find(
      (e: GraphEdge) =>
        e.edgeType === "tag" &&
        e.label === "ai" &&
        e.from === "alice-example" &&
        e.to === "acme-labs"
    );
    expect(ab).toBeDefined();
    expect(ba).toBeDefined();
    expect(ab?.weight).toBe(1);
  });

  test("singleton tag creates no edge", () => {
    fixture();
    const g = buildGraph(ROOT);
    // Carol's "nlp" tag is unique.
    const carolTagEdges = g.edges.filter(
      (e: GraphEdge) => e.edgeType === "tag" && e.label === "nlp"
    );
    expect(carolTagEdges).toEqual([]);
  });

  test("tag-group cap of 50 limits edge explosion", () => {
    // Seed 60 entities sharing one tag → expect edges only among first 50
    // (sorted slugs). Pairs = C(50,2) = 1225, doubled (bidirectional) = 2450.
    for (let i = 0; i < 60; i++) {
      seed({
        domain: "Ideas",
        name: `Idea ${String(i).padStart(3, "0")}`,
        tags: ["common"],
      });
    }
    const g = buildGraph(ROOT);
    const commonEdges = g.edges.filter(
      (e: GraphEdge) => e.edgeType === "tag" && e.label === "common"
    );
    expect(commonEdges.length).toBe(50 * 49); // 2 × C(50,2) = 50*49
  });
});

// --- resolveSlug ------------------------------------------------------------

describe("resolveSlug", () => {
  test("exact match", () => {
    fixture();
    const g = buildGraph(ROOT);
    expect(resolveSlug(g, "alice-example")).toBe("alice-example");
  });

  test("substring match", () => {
    fixture();
    const g = buildGraph(ROOT);
    expect(resolveSlug(g, "alice")).toBe("alice-example");
  });

  test("multiple substring matches → shortest wins", () => {
    seed({ domain: "Ideas", name: "alpha" });
    seed({ domain: "Ideas", name: "alpha beta" });
    const g = buildGraph(ROOT);
    expect(resolveSlug(g, "alpha")).toBe("alpha");
  });

  test("no match → null", () => {
    fixture();
    const g = buildGraph(ROOT);
    expect(resolveSlug(g, "nonexistent")).toBeNull();
  });
});

// --- traverse ---------------------------------------------------------------

describe("traverse — BFS", () => {
  test("hop 0 returns start node only when maxHops=0", () => {
    fixture();
    const g = buildGraph(ROOT);
    const r = traverse(g, "alice-example", 0);
    expect(r.length).toBe(1);
    expect(r[0].node.slug).toBe("alice-example");
    expect(r[0].hop).toBe(0);
  });

  test("1 hop reaches direct neighbors only", () => {
    fixture();
    const g = buildGraph(ROOT);
    const r = traverse(g, "alice-example", 1);
    const reached = r.map((t) => t.node.slug).sort();
    // Alice has: related→acme-labs (5), wikilink→bob-example (3),
    // tag→acme-labs (already covered) + tag→beta-corp (ai) + tag→acme-labs
    // Plus: tag→ direct on shared "ai" tag with acme-labs, beta-corp, etc.
    expect(reached).toContain("alice-example");
    expect(reached).toContain("acme-labs");
    expect(reached).toContain("bob-example");
    expect(reached).toContain("beta-corp"); // shared "ai" tag
    // Carol has no edges, must NOT appear.
    expect(reached).not.toContain("carol-solo");
  });

  test("isolated node returns just itself", () => {
    fixture();
    const g = buildGraph(ROOT);
    const r = traverse(g, "carol-solo", 3);
    expect(r.length).toBe(1);
    expect(r[0].node.slug).toBe("carol-solo");
  });

  test("unknown start → empty", () => {
    fixture();
    const g = buildGraph(ROOT);
    expect(traverse(g, "ghost", 5)).toEqual([]);
  });

  test("higher-weight edge wins per target (related > wikilink > tag)", () => {
    fixture();
    const g = buildGraph(ROOT);
    const r = traverse(g, "alice-example", 1);
    const acme = r.find((t) => t.node.slug === "acme-labs");
    // alice → acme-labs has BOTH a related edge (weight 5) and a tag edge
    // (weight 1, via "ai"). BFS picks the related edge.
    expect(acme?.viaEdge?.edgeType).toBe("related");
    expect(acme?.viaEdge?.weight).toBe(5);
  });
});

// --- stats ------------------------------------------------------------------

describe("stats", () => {
  test("counts nodes by domain", () => {
    fixture();
    const s = stats(buildGraph(ROOT));
    expect(s.nodes).toBe(5);
    expect(s.nodesByDomain.People).toBe(3);
    expect(s.nodesByDomain.Companies).toBe(2);
    expect(s.nodesByDomain.Ideas).toBe(0);
  });

  test("counts edges by type", () => {
    fixture();
    const s = stats(buildGraph(ROOT));
    expect(s.edgesByType.related).toBeGreaterThan(0);
    expect(s.edgesByType.wikilink).toBeGreaterThan(0);
    expect(s.edgesByType.tag).toBeGreaterThan(0);
    expect(s.edges).toBe(
      s.edgesByType.related + s.edgesByType.wikilink + s.edgesByType.tag
    );
  });

  test("reports isolated nodes (carol)", () => {
    fixture();
    const s = stats(buildGraph(ROOT));
    expect(s.isolatedNodes).toBe(1);
  });

  test("empty graph stats", () => {
    const s = stats(buildGraph(ROOT));
    expect(s.nodes).toBe(0);
    expect(s.edges).toBe(0);
    expect(s.isolatedNodes).toBe(0);
    expect(s.mostConnected).toBeNull();
  });
});

// --- No-mutation invariant --------------------------------------------------

describe("no mutation of underlying entities", () => {
  test("buildGraph does not modify files on disk", () => {
    fixture();
    const before = save; // identity check
    const g1 = buildGraph(ROOT);
    const g2 = buildGraph(ROOT);
    expect(g1.nodes.size).toBe(g2.nodes.size);
    expect(g1.edges.length).toBe(g2.edges.length);
    expect(before).toBe(save);
  });
});

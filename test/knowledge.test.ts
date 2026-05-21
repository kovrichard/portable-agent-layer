import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  DOMAINS,
  type Entity,
  exists,
  getOrCreate,
  list,
  load,
  parse,
  RELATION_TYPES,
  STATUSES,
  save,
  serialize,
  slugify,
  validate,
} from "../src/tools/knowledge/lib";

const ROOT = resolve(import.meta.dir, "../.test-tmp/knowledge");

beforeEach(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
});

// --- Constants --------------------------------------------------------------

describe("constants", () => {
  test("4 domains", () => {
    expect(DOMAINS).toEqual(["People", "Companies", "Ideas", "Research"]);
  });

  test("8 PAI relation types", () => {
    expect(RELATION_TYPES.length).toBe(8);
    expect(RELATION_TYPES).toContain("supports");
    expect(RELATION_TYPES).toContain("contradicts");
    expect(RELATION_TYPES).toContain("extends");
    expect(RELATION_TYPES).toContain("part-of");
    expect(RELATION_TYPES).toContain("instance-of");
    expect(RELATION_TYPES).toContain("caused-by");
    expect(RELATION_TYPES).toContain("preceded-by");
    expect(RELATION_TYPES).toContain("related");
  });

  test("3 statuses", () => {
    expect(STATUSES).toEqual(["seedling", "budding", "evergreen"]);
  });
});

// --- Slugify ----------------------------------------------------------------

describe("slugify", () => {
  test("kebab-cases plain names", () => {
    expect(slugify("Andrej Karpathy")).toBe("andrej-karpathy");
  });

  test("strips diacritics", () => {
    expect(slugify("François Müller")).toBe("francois-muller");
  });

  test("collapses punctuation and whitespace", () => {
    expect(slugify("  Multi   Word — name!  ")).toBe("multi-word-name");
  });

  test("deterministic across calls", () => {
    const a = slugify("Example Labs Kft.");
    const b = slugify("Example Labs Kft.");
    expect(a).toBe(b);
    expect(a).toBe("example-labs-kft");
  });

  test("non-ASCII collapses without diacritics", () => {
    expect(slugify("École Polytechnique")).toBe("ecole-polytechnique");
  });
});

// --- Round-trip -------------------------------------------------------------

function sample(): Entity {
  return {
    domain: "People",
    slug: "andrej-karpathy",
    frontmatter: {
      title: "Andrej Karpathy",
      type: "person",
      tags: ["ai", "llm", "research"],
      created: "2026-05-21T10:00:00.000Z",
      updated: "2026-05-21T10:00:00.000Z",
      quality: 7,
      status: "budding",
      related: [
        { slug: "openai", type: "instance-of" },
        { slug: "scaling-laws", type: "supports" },
      ],
      role: "author",
      title_short: "ex-OpenAI, ex-Tesla AI",
      socials: ["@karpathy"],
    },
    body: "Notes about Andrej.\n",
  };
}

describe("serialize / parse", () => {
  test("round-trip preserves canonical fields", () => {
    const e = sample();
    const text = serialize(e);
    const parsed = parse(e.domain, e.slug, text);
    expect(parsed.frontmatter.title).toBe(e.frontmatter.title);
    expect(parsed.frontmatter.type).toBe(e.frontmatter.type);
    expect(parsed.frontmatter.tags).toEqual(e.frontmatter.tags);
    expect(parsed.frontmatter.quality).toBe(e.frontmatter.quality);
    expect(parsed.frontmatter.status).toBe(e.frontmatter.status);
    expect(parsed.frontmatter.related).toEqual(e.frontmatter.related);
  });

  test("round-trip preserves rich extras", () => {
    const e = sample();
    const text = serialize(e);
    const parsed = parse(e.domain, e.slug, text);
    expect(parsed.frontmatter.role).toBe("author");
    expect(parsed.frontmatter.title_short).toBe("ex-OpenAI, ex-Tesla AI");
    expect(parsed.frontmatter.socials).toEqual(["@karpathy"]);
  });

  test("emit is stable (serialize twice = same text)", () => {
    const e = sample();
    const a = serialize(e);
    const parsed = parse(e.domain, e.slug, a);
    const b = serialize({ ...e, frontmatter: parsed.frontmatter });
    expect(b).toBe(a);
  });

  test("empty related serializes as inline []", () => {
    const e = sample();
    e.frontmatter.related = [];
    const text = serialize(e);
    expect(text).toContain("related: []");
  });

  test("body preserved", () => {
    const e = sample();
    const parsed = parse(e.domain, e.slug, serialize(e));
    expect(parsed.body.trim()).toBe("Notes about Andrej.");
  });
});

// --- Validation -------------------------------------------------------------

describe("validate", () => {
  test("rejects quality out of range", () => {
    const e = sample();
    e.frontmatter.quality = 11;
    expect(() => validate(e)).toThrow(/quality/);
  });

  test("rejects bad status", () => {
    const e = sample();
    // biome-ignore lint/suspicious/noExplicitAny: deliberate bad input
    e.frontmatter.status = "rotten" as any;
    expect(() => validate(e)).toThrow(/status/);
  });

  test("rejects bad relation type", () => {
    const e = sample();
    // biome-ignore lint/suspicious/noExplicitAny: deliberate bad input
    e.frontmatter.related = [{ slug: "x", type: "knows" as any }];
    expect(() => validate(e)).toThrow(/related/);
  });

  test("rejects bad domain", () => {
    const e = sample();
    // biome-ignore lint/suspicious/noExplicitAny: deliberate bad input
    e.domain = "Animals" as any;
    expect(() => validate(e)).toThrow(/domain/);
  });
});

// --- Filesystem -------------------------------------------------------------

describe("save / load / exists", () => {
  test("save then load round-trips through disk", () => {
    const e = sample();
    save(e, ROOT);
    expect(exists(e.domain, e.slug, ROOT)).toBe(true);
    const loaded = load(e.domain, e.slug, ROOT);
    expect(loaded).not.toBeNull();
    expect(loaded?.frontmatter.title).toBe(e.frontmatter.title);
    expect(loaded?.frontmatter.related).toEqual(e.frontmatter.related);
    expect(loaded?.frontmatter.role).toBe("author");
  });

  test("load returns null when missing", () => {
    expect(load("People", "ghost", ROOT)).toBeNull();
  });

  test("save is atomic — no .tmp leftover", () => {
    save(sample(), ROOT);
    const dir = resolve(ROOT, "People");
    const files = readdirSync(dir);
    expect(files).toContain("andrej-karpathy.md");
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  test("list returns all entities in a domain", () => {
    save(sample(), ROOT);
    save(
      {
        ...sample(),
        slug: "yann-lecun",
        frontmatter: { ...sample().frontmatter, title: "Yann LeCun" },
      },
      ROOT
    );
    const entries = list("People", ROOT);
    expect(entries.length).toBe(2);
    const slugs = entries.map((e) => e.slug).sort();
    expect(slugs).toEqual(["andrej-karpathy", "yann-lecun"]);
  });

  test("list across all domains", () => {
    save(sample(), ROOT);
    save(
      {
        domain: "Companies",
        slug: "openai",
        frontmatter: {
          title: "OpenAI",
          type: "ai-lab",
          tags: ["ai"],
          created: "2026-05-21T10:00:00.000Z",
          updated: "2026-05-21T10:00:00.000Z",
          quality: 5,
          status: "seedling",
          related: [],
        },
        body: "",
      },
      ROOT
    );
    const all = list(undefined, ROOT);
    expect(all.length).toBe(2);
  });
});

// --- getOrCreate ------------------------------------------------------------

describe("getOrCreate", () => {
  test("creates with sensible defaults", () => {
    const e = getOrCreate({ domain: "Companies", name: "Acme Labs" }, ROOT);
    expect(e.slug).toBe("acme-labs");
    expect(e.frontmatter.title).toBe("Acme Labs");
    expect(e.frontmatter.status).toBe("seedling");
    expect(e.frontmatter.quality).toBe(5);
    expect(e.frontmatter.type).toBe("company");
    expect(exists("Companies", "acme-labs", ROOT)).toBe(true);
  });

  test("idempotent: second call returns existing untouched", async () => {
    const a = getOrCreate({ domain: "People", name: "Yann LeCun", tags: ["ai"] }, ROOT);
    // Give 10ms so any 'updated' bump would visibly differ.
    await new Promise((r) => setTimeout(r, 10));
    const b = getOrCreate({ domain: "People", name: "Yann LeCun", tags: ["meta"] }, ROOT);
    expect(b.frontmatter.updated).toBe(a.frontmatter.updated);
    expect(b.frontmatter.tags).toEqual(["ai"]);
  });

  test("respects supplied attributes", () => {
    const e = getOrCreate(
      {
        domain: "Ideas",
        name: "Scaling Laws",
        type: "thesis",
        tags: ["ml"],
        quality: 8,
        status: "evergreen",
        related: [{ slug: "andrej-karpathy", type: "supports" }],
        body: "Bigger == better, mostly.",
        extra: { confidence: 0.9 },
      },
      ROOT
    );
    expect(e.frontmatter.type).toBe("thesis");
    expect(e.frontmatter.status).toBe("evergreen");
    expect(e.frontmatter.quality).toBe(8);
    expect(e.frontmatter.related[0].type).toBe("supports");
    expect(e.frontmatter.confidence).toBe(0.9);
    expect(e.body).toBe("Bigger == better, mostly.");
  });

  test("rejects empty slug", () => {
    expect(() => getOrCreate({ domain: "People", name: "!!!" }, ROOT)).toThrow();
  });
});

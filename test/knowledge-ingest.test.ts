import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { ingestEntities } from "../src/tools/knowledge/ingest";
import { exists, load } from "../src/tools/knowledge/lib";

const ROOT = resolve(import.meta.dir, "../.test-tmp/knowledge-ingest");

beforeEach(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
});

// --- Fresh ingest -----------------------------------------------------------

describe("ingestEntities — fresh", () => {
  test("creates person + company files", () => {
    const result = ingestEntities(
      {
        people: [
          {
            name: "Alice Example",
            role: "author",
            title: "Researcher",
            company: "Acme Labs",
            social: { twitter: "@alice", linkedin: "https://lk/alice" },
            context: "Wrote the seminal paper on widgets.",
            importance: "primary",
          },
        ],
        companies: [
          {
            name: "Acme Labs",
            domain: "acme.example",
            industry: "ai-research",
            mentioned_as: "subject",
            sentiment: "positive",
            context: "Founded 2020, focuses on widget research.",
          },
        ],
      },
      "https://example.com/article-1",
      ROOT
    );

    expect(result.people).toEqual([{ slug: "alice-example", created: true }]);
    expect(result.companies).toEqual([{ slug: "acme-example", created: true }]);
    expect(exists("People", "alice-example", ROOT)).toBe(true);
    expect(exists("Companies", "acme-example", ROOT)).toBe(true);
  });

  test("person rich fields are preserved as frontmatter", () => {
    ingestEntities(
      {
        people: [
          {
            name: "Alice Example",
            role: "author",
            title: "Researcher",
            company: "Acme Labs",
            social: { twitter: "@alice" },
            importance: "primary",
            context: "Quoted in article.",
          },
        ],
      },
      "src-1",
      ROOT
    );
    const p = load("People", "alice-example", ROOT);
    expect(p?.frontmatter.role).toBe("author");
    expect(p?.frontmatter.position).toBe("Researcher");
    expect(p?.frontmatter.company).toBe("Acme Labs");
    expect(p?.frontmatter.importance).toBe("primary");
    expect(p?.frontmatter.socials).toEqual(["twitter:@alice"]);
  });

  test("company rich fields preserved + industry becomes a tag", () => {
    ingestEntities(
      {
        companies: [
          {
            name: "Acme Labs",
            domain: "acme.example",
            industry: "ai-research",
            sentiment: "neutral",
            mentioned_as: "subject",
          },
        ],
      },
      "src-1",
      ROOT
    );
    const c = load("Companies", "acme-example", ROOT);
    expect(c?.frontmatter.domain_name).toBe("acme.example");
    expect(c?.frontmatter.industry).toBe("ai-research");
    expect(c?.frontmatter.sentiment).toBe("neutral");
    expect(c?.frontmatter.mentioned_as).toBe("subject");
    expect(c?.frontmatter.tags).toContain("ai-research");
  });

  test("person body contains source log with marker + context", () => {
    ingestEntities(
      {
        people: [
          {
            name: "Alice Example",
            role: "author",
            context: "Wrote the widget paper.",
            importance: "primary",
          },
        ],
      },
      "src-A",
      ROOT
    );
    const p = load("People", "alice-example", ROOT);
    expect(p?.body).toContain("<!-- src:src-A -->");
    expect(p?.body).toContain("Wrote the widget paper.");
    expect(p?.body).toContain("role: author");
  });
});

// --- Auto-edge person → company --------------------------------------------

describe("auto-edge person → company", () => {
  test("creates part-of related edge when person has company field", () => {
    ingestEntities(
      {
        people: [{ name: "Alice Example", company: "Acme Labs" }],
        companies: [{ name: "Acme Labs", domain: "acme.example" }],
      },
      "src-1",
      ROOT
    );
    const p = load("People", "alice-example", ROOT);
    const rel = p?.frontmatter.related.find((r) => r.type === "part-of");
    expect(rel?.slug).toBe("acme-example");
  });

  test("stub-creates company if missing, then edges to it", () => {
    ingestEntities(
      {
        people: [{ name: "Bob Example", company: "Unknown Co" }],
      },
      "src-1",
      ROOT
    );
    expect(exists("Companies", "unknown-co", ROOT)).toBe(true);
    const p = load("People", "bob-example", ROOT);
    expect(
      p?.frontmatter.related.find((r) => r.type === "part-of" && r.slug === "unknown-co")
    ).toBeDefined();
  });

  test("no duplicate edges when re-ingested", () => {
    const payload = {
      people: [{ name: "Alice Example", company: "Acme Labs" }],
    };
    ingestEntities(payload, "src-1", ROOT);
    ingestEntities(payload, "src-2", ROOT);
    const p = load("People", "alice-example", ROOT);
    const partOf = p?.frontmatter.related.filter((r) => r.type === "part-of");
    expect(partOf?.length).toBe(1);
  });
});

// --- Merge semantics --------------------------------------------------------

describe("merge — second ingest enriches without overwriting", () => {
  test("non-null new value updates", () => {
    ingestEntities(
      { people: [{ name: "Alice Example", role: "author" }] },
      "src-1",
      ROOT
    );
    ingestEntities(
      { people: [{ name: "Alice Example", role: "expert", title: "CTO" }] },
      "src-2",
      ROOT
    );
    const p = load("People", "alice-example", ROOT);
    expect(p?.frontmatter.role).toBe("expert"); // updated
    expect(p?.frontmatter.position).toBe("CTO"); // newly added
  });

  test("null/undefined new value leaves prior intact", () => {
    ingestEntities(
      {
        people: [{ name: "Alice Example", role: "author", company: "Acme Labs" }],
      },
      "src-1",
      ROOT
    );
    ingestEntities(
      { people: [{ name: "Alice Example", role: null, company: null }] },
      "src-2",
      ROOT
    );
    const p = load("People", "alice-example", ROOT);
    expect(p?.frontmatter.role).toBe("author"); // preserved
    expect(p?.frontmatter.company).toBe("Acme Labs"); // preserved
  });

  test("socials union across ingests, prefers new on key collision", () => {
    ingestEntities(
      {
        people: [{ name: "Alice Example", social: { twitter: "@alice_old" } }],
      },
      "src-1",
      ROOT
    );
    ingestEntities(
      {
        people: [
          {
            name: "Alice Example",
            social: { twitter: "@alice_new", linkedin: "https://lk/alice" },
          },
        ],
      },
      "src-2",
      ROOT
    );
    const p = load("People", "alice-example", ROOT);
    const socials = p?.frontmatter.socials as string[];
    expect(socials).toContain("twitter:@alice_new");
    expect(socials).toContain("linkedin:https://lk/alice");
    expect(socials).not.toContain("twitter:@alice_old");
  });

  test("company industry merges into tags without dup", () => {
    ingestEntities(
      { companies: [{ name: "Acme Labs", industry: "ai-research" }] },
      "src-1",
      ROOT
    );
    ingestEntities(
      { companies: [{ name: "Acme Labs", industry: "ai-research" }] },
      "src-2",
      ROOT
    );
    const c = load("Companies", "acme-labs", ROOT);
    const aiTags = c?.frontmatter.tags.filter((t) => t === "ai-research");
    expect(aiTags?.length).toBe(1);
  });
});

// --- Idempotent re-ingest ---------------------------------------------------

describe("idempotent re-ingest (same source)", () => {
  test("same source twice does not duplicate body log section", () => {
    const payload = {
      people: [
        {
          name: "Alice Example",
          role: "author",
          context: "Specific phrasing here.",
        },
      ],
    };
    ingestEntities(payload, "src-X", ROOT);
    ingestEntities(payload, "src-X", ROOT);
    const p = load("People", "alice-example", ROOT);
    const marker = p?.body.match(/<!-- src:src-X -->/g);
    expect(marker?.length).toBe(1);
  });

  test("different sources both leave their own log sections", () => {
    ingestEntities(
      {
        people: [{ name: "Alice Example", context: "First mention." }],
      },
      "src-1",
      ROOT
    );
    ingestEntities(
      {
        people: [{ name: "Alice Example", context: "Second mention." }],
      },
      "src-2",
      ROOT
    );
    const p = load("People", "alice-example", ROOT);
    expect(p?.body).toContain("<!-- src:src-1 -->");
    expect(p?.body).toContain("<!-- src:src-2 -->");
    expect(p?.body).toContain("First mention.");
    expect(p?.body).toContain("Second mention.");
  });
});

// --- Result reporting -------------------------------------------------------

describe("ingestEntities — result", () => {
  test("reports created vs updated correctly", () => {
    ingestEntities(
      {
        people: [{ name: "Alice Example" }],
        companies: [{ name: "Acme Labs" }],
      },
      "src-1",
      ROOT
    );
    const second = ingestEntities(
      {
        people: [{ name: "Alice Example" }, { name: "Bob Example" }],
        companies: [{ name: "Acme Labs" }, { name: "Beta Corp" }],
      },
      "src-2",
      ROOT
    );
    expect(second.people).toEqual([
      { slug: "alice-example", created: false },
      { slug: "bob-example", created: true },
    ]);
    expect(second.companies).toEqual([
      { slug: "acme-labs", created: false },
      { slug: "beta-corp", created: true },
    ]);
  });

  test("empty input yields empty result", () => {
    const r = ingestEntities({}, "src-1", ROOT);
    expect(r).toEqual({ people: [], companies: [] });
  });
});

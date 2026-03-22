import { describe, expect, test } from "bun:test";
import { hasFrontmatter, parse, stringify } from "../src/hooks/lib/frontmatter";

describe("parse", () => {
  test("parses frontmatter with string values", () => {
    const content = `---
title: My Title
category: algorithm
---

Body content here.
`;
    const result = parse<{ title: string; category: string }>(content);
    expect(result.meta.title).toBe("My Title");
    expect(result.meta.category).toBe("algorithm");
    expect(result.body).toBe("Body content here.");
  });

  test("parses numeric values", () => {
    const content = `---
rating: 3
confidence: 85
---

Body.
`;
    const result = parse<{ rating: number; confidence: number }>(content);
    expect(result.meta.rating).toBe(3);
    expect(result.meta.confidence).toBe(85);
  });

  test("parses boolean values", () => {
    const content = `---
completed: true
skipped: false
---

Body.
`;
    const result = parse<{ completed: boolean; skipped: boolean }>(content);
    expect(result.meta.completed).toBe(true);
    expect(result.meta.skipped).toBe(false);
  });

  test("returns empty meta when no frontmatter", () => {
    const content = "# Just a heading\n\nSome body text.";
    const result = parse(content);
    expect(Object.keys(result.meta)).toHaveLength(0);
    expect(result.body).toBe(content);
  });

  test("returns empty meta for legacy **Key:** format", () => {
    const content = `# Work Completion Learning
**Title:** Some title
**Category:** ALGORITHM

## What Was Done
Something.
`;
    const result = parse(content);
    expect(Object.keys(result.meta)).toHaveLength(0);
    expect(result.body).toBe(content);
  });

  test("parses quoted strings with colons", () => {
    const content = `---
context: "User frustrated by inconsistency: why didn't you remember?"
rating: 2
---

Body.
`;
    const result = parse<{ context: string; rating: number }>(content);
    expect(result.meta.context).toBe(
      "User frustrated by inconsistency: why didn't you remember?"
    );
    expect(result.meta.rating).toBe(2);
  });

  test("handles content with --- inside body", () => {
    const content = `---
title: Test
---

Some text with --- separator in the middle.
`;
    const result = parse<{ title: string }>(content);
    expect(result.meta.title).toBe("Test");
    expect(result.body).toContain("--- separator");
  });
});

describe("stringify", () => {
  test("creates frontmatter string", () => {
    const result = stringify(
      { title: "My Title", category: "algorithm" },
      "Body content."
    );
    expect(result).toBe(`---
title: "My Title"
category: "algorithm"
---

Body content.
`);
  });

  test("skips undefined and null values", () => {
    const result = stringify({ title: "Test", session: undefined, extra: null }, "Body.");
    expect(result).toContain('title: "Test"');
    expect(result).not.toContain("session");
    expect(result).not.toContain("extra");
  });

  test("handles numeric and boolean values", () => {
    const result = stringify({ rating: 3, completed: true }, "Body.");
    expect(result).toContain("rating: 3");
    expect(result).toContain("completed: true");
  });

  test("quotes strings with colons", () => {
    const result = stringify({ context: "User frustrated: why not?" }, "Body.");
    expect(result).toContain('context: "User frustrated: why not?"');
  });
});

describe("hasFrontmatter", () => {
  test("returns true for frontmatter content", () => {
    expect(hasFrontmatter("---\ntitle: Test\n---\nBody")).toBe(true);
  });

  test("returns false for plain content", () => {
    expect(hasFrontmatter("# Heading\nBody")).toBe(false);
  });

  test("returns false for **Key:** format", () => {
    expect(hasFrontmatter("**Title:** Test\nBody")).toBe(false);
  });
});

describe("roundtrip", () => {
  test("parse(stringify(...)) preserves data", () => {
    const meta = { title: "Roundtrip Test", category: "system", date: "2026-03-22" };
    const body = "## What Was Done\nSomething useful.\n\n## Insights\n- Learned a thing.";

    const serialized = stringify(meta, body);
    const { meta: parsedMeta, body: parsedBody } = parse<typeof meta>(serialized);

    expect(parsedMeta.title).toBe("Roundtrip Test");
    expect(parsedMeta.category).toBe("system");
    expect(parsedMeta.date).toBe("2026-03-22");
    expect(parsedBody).toContain("Something useful.");
    expect(parsedBody).toContain("Learned a thing.");
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  getExistingContentId,
  getOrCreateCompany,
  getOrCreateLink,
  getOrCreatePerson,
  getOrCreateSource,
  isUrlAlreadyParsed,
  loadEntityIndex,
  normalizeCompanyKey,
  normalizeName,
  normalizeSourceKey,
  normalizeUrl,
  processEntities,
  saveEntityIndex,
} from "../src/hooks/lib/entities";

const TEST_DIR = resolve(import.meta.dir, "../.test-tmp");
const TEST_INDEX = resolve(TEST_DIR, "entity-index.json");

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

// --- Normalization ---

describe("normalizeName", () => {
  test("lowercases and trims", () => {
    expect(normalizeName("  Dario Amodei  ")).toBe("dario amodei");
  });
});

describe("normalizeCompanyKey", () => {
  test("uses domain when available", () => {
    expect(normalizeCompanyKey("Anthropic", "Anthropic.com")).toBe("anthropic.com");
  });

  test("falls back to name when no domain", () => {
    expect(normalizeCompanyKey("Hiflylabs", null)).toBe("hiflylabs");
  });
});

// --- Index I/O ---

describe("normalizeUrl", () => {
  test("lowercases, trims, strips trailing slash", () => {
    expect(normalizeUrl("  HTTPS://Example.COM/  ")).toBe("https://example.com");
  });
});

describe("normalizeSourceKey", () => {
  test("uses URL when available", () => {
    expect(normalizeSourceKey("https://arxiv.org/abs/123", null, null)).toBe(
      "https://arxiv.org/abs/123"
    );
  });

  test("falls back to author|publication", () => {
    expect(normalizeSourceKey(null, "John Doe", "Nature")).toBe("john doe|nature");
  });
});

describe("loadEntityIndex", () => {
  test("returns empty index when file missing", () => {
    const index = loadEntityIndex(TEST_INDEX);
    expect(index.people).toEqual({});
    expect(index.companies).toEqual({});
    expect(index.links).toEqual({});
    expect(index.sources).toEqual({});
  });

  test("loads existing index from disk", () => {
    const index = loadEntityIndex(TEST_INDEX);
    getOrCreatePerson({ name: "Alice" }, index, "src-1");
    saveEntityIndex(index, TEST_INDEX);

    const reloaded = loadEntityIndex(TEST_INDEX);
    expect(Object.keys(reloaded.people)).toHaveLength(1);
    expect(reloaded.people.alice.name).toBe("Alice");
  });
});

// --- Person deduplication ---

describe("getOrCreatePerson", () => {
  test("creates new person with UUID", () => {
    const index = loadEntityIndex(TEST_INDEX);
    const id = getOrCreatePerson({ name: "Rico" }, index, "src-1");

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(index.people.rico.occurrences).toBe(1);
    expect(index.people.rico.source_ids).toEqual(["src-1"]);
  });

  test("deduplicates by normalized name", () => {
    const index = loadEntityIndex(TEST_INDEX);
    const id1 = getOrCreatePerson({ name: "Rico" }, index, "src-1");
    const id2 = getOrCreatePerson({ name: "  rico  " }, index, "src-2");

    expect(id1).toBe(id2);
    expect(index.people.rico.occurrences).toBe(2);
    expect(index.people.rico.source_ids).toEqual(["src-1", "src-2"]);
  });

  test("does not double-count same source", () => {
    const index = loadEntityIndex(TEST_INDEX);
    getOrCreatePerson({ name: "Rico" }, index, "src-1");
    getOrCreatePerson({ name: "Rico" }, index, "src-1");

    expect(index.people.rico.occurrences).toBe(1);
    expect(index.people.rico.source_ids).toEqual(["src-1"]);
  });
});

// --- Company deduplication ---

describe("getOrCreateCompany", () => {
  test("deduplicates by domain", () => {
    const index = loadEntityIndex(TEST_INDEX);
    const id1 = getOrCreateCompany(
      { name: "Anthropic", domain: "anthropic.com" },
      index,
      "src-1"
    );
    const id2 = getOrCreateCompany(
      { name: "Anthropic, PBC", domain: "Anthropic.com" },
      index,
      "src-2"
    );

    expect(id1).toBe(id2);
    expect(Object.keys(index.companies)).toHaveLength(1);
    expect(index.companies["anthropic.com"].occurrences).toBe(2);
  });

  test("deduplicates by name when no domain", () => {
    const index = loadEntityIndex(TEST_INDEX);
    const id1 = getOrCreateCompany({ name: "Hiflylabs", domain: null }, index, "src-1");
    const id2 = getOrCreateCompany({ name: "hiflylabs", domain: null }, index, "src-2");

    expect(id1).toBe(id2);
  });

  test("different domains create different entries", () => {
    const index = loadEntityIndex(TEST_INDEX);
    getOrCreateCompany({ name: "Google", domain: "google.com" }, index, "src-1");
    getOrCreateCompany({ name: "DeepMind", domain: "deepmind.com" }, index, "src-1");

    expect(Object.keys(index.companies)).toHaveLength(2);
  });
});

// --- Link deduplication ---

describe("getOrCreateLink", () => {
  test("creates new link with UUID", () => {
    const index = loadEntityIndex(TEST_INDEX);
    const id = getOrCreateLink({ url: "https://example.com/post" }, index, "src-1");

    expect(id).toMatch(/^[0-9a-f]{8}-/);
    expect(index.links["https://example.com/post"].occurrences).toBe(1);
  });

  test("deduplicates by normalized URL", () => {
    const index = loadEntityIndex(TEST_INDEX);
    const id1 = getOrCreateLink({ url: "https://Example.COM/" }, index, "src-1");
    const id2 = getOrCreateLink({ url: "https://example.com" }, index, "src-2");

    expect(id1).toBe(id2);
    expect(index.links["https://example.com"].occurrences).toBe(2);
  });
});

// --- Source deduplication ---

describe("getOrCreateSource", () => {
  test("deduplicates by URL", () => {
    const index = loadEntityIndex(TEST_INDEX);
    const id1 = getOrCreateSource(
      { url: "https://arxiv.org/abs/123", author: null, publication: null },
      index,
      "src-1"
    );
    const id2 = getOrCreateSource(
      { url: "https://arxiv.org/abs/123", author: "Someone", publication: null },
      index,
      "src-2"
    );

    expect(id1).toBe(id2);
  });

  test("deduplicates by author|publication when no URL", () => {
    const index = loadEntityIndex(TEST_INDEX);
    const id1 = getOrCreateSource(
      { url: null, author: "John Doe", publication: "Nature" },
      index,
      "src-1"
    );
    const id2 = getOrCreateSource(
      { url: null, author: "john doe", publication: "Nature" },
      index,
      "src-2"
    );

    expect(id1).toBe(id2);
    expect(Object.keys(index.sources)).toHaveLength(1);
  });
});

// --- URL dedup checks ---

describe("isUrlAlreadyParsed", () => {
  test("returns false for unknown URL", () => {
    const index = loadEntityIndex(TEST_INDEX);
    expect(isUrlAlreadyParsed("https://new.com", index)).toBe(false);
  });

  test("returns true for known URL", () => {
    const index = loadEntityIndex(TEST_INDEX);
    getOrCreateLink({ url: "https://known.com" }, index, "src-1");
    expect(isUrlAlreadyParsed("https://known.com", index)).toBe(true);
  });
});

describe("getExistingContentId", () => {
  test("returns first source_id for known URL", () => {
    const index = loadEntityIndex(TEST_INDEX);
    getOrCreateLink({ url: "https://known.com" }, index, "src-1");
    expect(getExistingContentId("https://known.com", index)).toBe("src-1");
  });

  test("returns null for unknown URL", () => {
    const index = loadEntityIndex(TEST_INDEX);
    expect(getExistingContentId("https://unknown.com", index)).toBeNull();
  });
});

// --- Batch processEntities ---

describe("processEntities", () => {
  test("assigns IDs and persists to disk", () => {
    const result = processEntities(
      {
        people: [{ name: "Alice" }, { name: "Bob" }],
        companies: [
          { name: "Acme", domain: "acme.com" },
          { name: "Globex", domain: null },
        ],
      },
      "https://example.com",
      TEST_INDEX
    );

    expect(result.people).toHaveLength(2);
    expect(result.companies).toHaveLength(2);
    expect(result.people[0].id).toBeDefined();
    expect(result.companies[0].id).toBeDefined();

    // Verify persisted
    const reloaded = loadEntityIndex(TEST_INDEX);
    expect(Object.keys(reloaded.people)).toHaveLength(2);
    expect(Object.keys(reloaded.companies)).toHaveLength(2);
  });

  test("deduplicates across multiple calls", () => {
    processEntities(
      {
        people: [{ name: "Alice" }],
        companies: [{ name: "Acme", domain: "acme.com" }],
      },
      "src-1",
      TEST_INDEX
    );

    processEntities(
      {
        people: [{ name: "Alice" }, { name: "Charlie" }],
        companies: [{ name: "Acme Corp", domain: "acme.com" }],
      },
      "src-2",
      TEST_INDEX
    );

    // Alice should get the same ID
    const index = loadEntityIndex(TEST_INDEX);
    expect(Object.keys(index.people)).toHaveLength(2);
    expect(index.people.alice.occurrences).toBe(2);
    expect(index.people.alice.source_ids).toEqual(["src-1", "src-2"]);

    // Acme deduped by domain
    expect(Object.keys(index.companies)).toHaveLength(1);
    expect(index.companies["acme.com"].occurrences).toBe(2);
  });

  test("preserves extra fields on entities", () => {
    const result = processEntities(
      {
        people: [{ name: "Alice", role: "author", title: "CEO" }],
        companies: [{ name: "Acme", domain: "acme.com", industry: "Tech" }],
      },
      "src-1",
      TEST_INDEX
    );

    expect(result.people[0].role).toBe("author");
    expect(result.people[0].title).toBe("CEO");
    expect(result.companies[0].industry).toBe("Tech");
  });
});

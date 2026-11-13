import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runMigrate } from "../src/cli/migrate";
import { v3EntitiesToKnowledge as v3 } from "../src/cli/migrations/v3-entities-to-knowledge";
import { exists, load } from "../src/tools/knowledge/lib";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

// Sandbox via PAL_HOME so the migration's path-resolution lands in our test home
// instead of touching the user's real ~/.pal.
const ROOT = testHome(import.meta.file);
const LEGACY_DIR = resolve(ROOT, "memory/entities");
const LEGACY_FILE = resolve(LEGACY_DIR, "entity-index.json");

beforeAll(() => {
  process.env.PAL_HOME = ROOT;
});

beforeEach(() => {
  removeOnceReleased(ROOT);
  mkdirSync(LEGACY_DIR, { recursive: true });
});

function seedLegacy(opts?: {
  withLinks?: boolean;
  withSources?: boolean;
  extraPeople?: number;
}): void {
  const index = {
    version: "1.1.0",
    last_updated: "2026-03-24T20:39:50.461Z",
    people: {
      "alice example": {
        id: "uuid-alice",
        name: "Alice Example",
        first_seen: "2026-03-19T18:28:39.587Z",
        occurrences: 2,
        source_ids: ["https://example.com/post-1", "doc-A.pdf"],
      },
      "bob example": {
        id: "uuid-bob",
        name: "Bob Example",
        first_seen: "2026-03-24T20:39:50.460Z",
        occurrences: 1,
        source_ids: ["doc-B.pdf"],
      },
    } as Record<string, unknown>,
    companies: {
      acmelabs: {
        id: "uuid-acme",
        name: "Acmelabs",
        domain: null,
        first_seen: "2026-03-19T18:28:39.587Z",
        occurrences: 1,
        source_ids: ["https://example.com/post-1"],
      },
      "beta-corp.example": {
        id: "uuid-beta",
        name: "Beta Corp",
        domain: "beta-corp.example",
        first_seen: "2026-03-24T20:39:50.461Z",
        occurrences: 1,
        source_ids: ["doc-A.pdf"],
      },
    } as Record<string, unknown>,
    links: opts?.withLinks
      ? { "https://example.com/x": { id: "L1", url: "https://example.com/x" } }
      : {},
    sources: opts?.withSources
      ? { "src-1": { id: "S1", url: null, author: "Anon", publication: null } }
      : {},
  };

  if (opts?.extraPeople) {
    for (let i = 0; i < opts.extraPeople; i++) {
      const key = `extra-${i}`;
      index.people[key] = {
        id: `uuid-extra-${i}`,
        name: `Extra Person ${i}`,
        first_seen: "2026-03-19T18:28:39.587Z",
        occurrences: 1,
        source_ids: [],
      };
    }
  }

  writeFileSync(LEGACY_FILE, JSON.stringify(index, null, 2));
}

function silently<T>(fn: () => T): T {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};

  try {
    return fn();
  } finally {
    console.log = log;
    console.error = err;
  }
}

// ── check / list ──────────────────────────────────────────────────

describe("v3-entities-to-knowledge — check", () => {
  test("--list reports pending when legacy JSON has entries", () => {
    seedLegacy();
    const captured: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => captured.push(a.join(" "));

    try {
      runMigrate(["--list"]);
    } finally {
      console.log = log;
    }

    const out = captured.join("\n");
    expect(out).toContain("v3-entities-to-knowledge");
    expect(out).toContain("4 of 4 entries to migrate");
  });

  test("--list reports done after migration", () => {
    seedLegacy();
    silently(() => runMigrate([]));
    const captured: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => captured.push(a.join(" "));

    try {
      runMigrate(["--list"]);
    } finally {
      console.log = log;
    }

    const out = captured.join("\n");
    expect(out).toContain("✓ v3-entities-to-knowledge");
  });

  test("no pending when legacy JSON absent", () => {
    // No seed call → no legacy file.
    const captured: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => captured.push(a.join(" "));

    try {
      runMigrate(["--list"]);
    } finally {
      console.log = log;
    }

    const out = captured.join("\n");
    // v3 should appear in the "Done" section (nothing pending), not "Pending".
    const pendingSection = out.split("Done:")[0];
    expect(pendingSection).not.toContain("v3-entities-to-knowledge");
  });
});

// ── dry-run ───────────────────────────────────────────────────────

describe("v3 — dry-run", () => {
  test("reports what would migrate without writing", () => {
    seedLegacy();
    const captured: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => captured.push(a.join(" "));

    try {
      runMigrate(["--dry-run"]);
    } finally {
      console.log = log;
    }

    const out = captured.join("\n");
    expect(out).toContain("would migrate");
    expect(out).toContain("People/alice-example");
    expect(out).toContain("Companies/beta-corp-example");
    // No actual files written
    expect(exists("People", "alice-example")).toBe(false);
    expect(exists("Companies", "beta-corp-example")).toBe(false);
    // Legacy file untouched
    expect(existsSync(LEGACY_FILE)).toBe(true);
  });
});

// ── run ───────────────────────────────────────────────────────────

describe("v3 — run", () => {
  test("creates markdown files with legacy-derived metadata", () => {
    seedLegacy();
    silently(() => runMigrate([]));

    const alice = load("People", "alice-example");
    expect(alice).not.toBeNull();
    expect(alice?.frontmatter.title).toBe("Alice Example");
    expect(alice?.frontmatter.type).toBe("person");
    expect(alice?.frontmatter.created).toBe("2026-03-19T18:28:39.587Z");
    expect(alice?.frontmatter.legacy_id).toBe("uuid-alice");
    expect(alice?.frontmatter.occurrences).toBe(2);
  });

  test("company with domain uses domain-derived slug + sets domain_name", () => {
    seedLegacy();
    silently(() => runMigrate([]));
    const beta = load("Companies", "beta-corp-example");
    expect(beta).not.toBeNull();
    expect(beta?.frontmatter.title).toBe("Beta Corp");
    expect(beta?.frontmatter.domain_name).toBe("beta-corp.example");
  });

  test("company without domain uses name-derived slug", () => {
    seedLegacy();
    silently(() => runMigrate([]));
    const acme = load("Companies", "acmelabs");
    expect(acme).not.toBeNull();
    expect(acme?.frontmatter.domain_name).toBeUndefined();
  });

  test("each source_ids[] entry replayed as per-source body section, dated to first_seen", () => {
    seedLegacy();
    silently(() => runMigrate([]));
    const alice = load("People", "alice-example");
    expect(alice?.body).toContain("<!-- src:https://example.com/post-1 -->");
    expect(alice?.body).toContain("<!-- src:doc-A.pdf -->");
    // Date in body header should match first_seen (2026-03-19), not today.
    expect(alice?.body).toContain("### 2026-03-19 — https://example.com/post-1");
  });

  test("renames legacy file to .migrated-YYYY-MM-DD after success", () => {
    seedLegacy();
    silently(() => runMigrate([]));
    expect(existsSync(LEGACY_FILE)).toBe(false);
    const archived = readdirSync(LEGACY_DIR).find((f) =>
      f.startsWith("entity-index.json.migrated-")
    );
    expect(archived).toBeDefined();
    // Archived file content matches the original (not deleted, just renamed).
    const data = JSON.parse(readFileSync(resolve(LEGACY_DIR, archived ?? ""), "utf-8"));
    expect(data.people["alice example"].id).toBe("uuid-alice");
  });
});

// ── idempotence ───────────────────────────────────────────────────

describe("v3 — idempotence", () => {
  test("second run is a no-op via check() filter", () => {
    seedLegacy();
    silently(() => runMigrate([]));

    // Simulate the legacy file still being present (e.g. a user restored it).
    const captured: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => captured.push(a.join(" "));

    try {
      seedLegacy();
      runMigrate([]);
    } finally {
      console.log = log;
    }

    const out = captured.join("\n");
    // check() reports pending=false because all 4 already exist in new store →
    // run loop skips v3 entirely and reports "Nothing to migrate".
    expect(out).toContain("Nothing to migrate");
  });
});

// ── abort on non-empty links/sources ──────────────────────────────

describe("v3 — bails on non-empty links/sources", () => {
  test("aborts when legacy has links", () => {
    seedLegacy({ withLinks: true });
    const captured: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => captured.push(a.join(" "));

    try {
      runMigrate([]);
    } finally {
      console.log = log;
    }

    const out = captured.join("\n");
    expect(out).toContain("aborted");
    expect(out).toContain("1 link");
    // No entities migrated, legacy file NOT renamed.
    expect(exists("People", "alice-example")).toBe(false);
    expect(existsSync(LEGACY_FILE)).toBe(true);
  });

  test("aborts when legacy has sources", () => {
    seedLegacy({ withSources: true });
    const captured: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => captured.push(a.join(" "));

    try {
      runMigrate([]);
    } finally {
      console.log = log;
    }

    expect(captured.join("\n")).toContain("aborted");
    expect(exists("People", "alice-example")).toBe(false);
  });
});

describe("v3 — what check and run return", () => {
  const nothing = { migrated: 0, skipped: 0, results: [] };
  const archivedToday = () =>
    `${LEGACY_FILE}.migrated-${new Date().toISOString().slice(0, 10)}`;

  test.each([
    ["no legacy index", undefined],
    ["an unreadable index", "{ not json"],
    ["an index with no entries", '{"people":{},"companies":{}}'],
  ])("is not pending with %s", (_label, content) => {
    if (content) writeFileSync(LEGACY_FILE, content);

    expect(v3.check()).toStrictEqual({ pending: false });
  });

  test("run does nothing without a readable index", () => {
    expect(v3.run()).toEqual(nothing);
    writeFileSync(LEGACY_FILE, "{ not json");
    expect(v3.run()).toEqual(nothing);
  });

  test("counts both links and sources it refuses to drop", () => {
    seedLegacy({ withLinks: true, withSources: true });
    expect(v3.run().skipped).toBe(2);
  });

  test("skips what the new store already holds and archives the index under today's date", () => {
    seedLegacy();
    silently(() => runMigrate([]));
    seedLegacy({ extraPeople: 1 });
    expect(v3.check().detail).toBe("1 of 5 entries to migrate");

    const { migrated, skipped, results } = v3.run();

    expect({ migrated, skipped }).toEqual({ migrated: 1, skipped: 4 });
    expect(results).toContain("People/alice-example: skipped (already in new store)");
    expect(results).toContain("People/extra-person-0: migrated");
    expect(results.at(-1)).toBe(`archived legacy index → ${archivedToday()}`);
    expect(existsSync(archivedToday())).toBe(true);

    const extra = load("People", "extra-person-0");
    expect(extra?.frontmatter.tags).toEqual([]);
    expect(extra?.body.trim()).toBe("");
    expect(load("Companies", "acmelabs")?.frontmatter).toMatchObject({
      type: "company",
      tags: [],
    });
  });

  test("leaves the index in place when nothing new was migrated", () => {
    seedLegacy();
    silently(() => runMigrate([]));
    seedLegacy();

    expect(v3.check()).toStrictEqual({ pending: false, detail: undefined });
    expect(v3.run().migrated).toBe(0);
    expect(existsSync(LEGACY_FILE)).toBe(true);
    expect(load("Companies", "acmelabs")?.body).toContain(
      "<!-- src:https://example.com/post-1 -->"
    );
  });

  test("warns instead of failing when the index cannot be archived", () => {
    seedLegacy();
    mkdirSync(resolve(archivedToday(), "occupied"), { recursive: true });

    const { migrated, results } = v3.run();

    expect(migrated).toBe(4);
    expect(results.at(-1)).toStartWith("warn: could not rename legacy index (");
    expect(existsSync(LEGACY_FILE)).toBe(true);
  });

  test("a company whose domain is blank is keyed by its name", () => {
    const company = {
      id: "uuid-blank",
      name: "Blank Domain Co",
      domain: "  ",
      first_seen: "2026-03-19T18:28:39.587Z",
      occurrences: 1,
      source_ids: [],
    };
    writeFileSync(LEGACY_FILE, JSON.stringify({ companies: { blank: company } }));

    expect(v3.run(true).results).toEqual(["Companies/blank-domain-co: would migrate"]);
    v3.run();
    writeFileSync(LEGACY_FILE, JSON.stringify({ companies: { blank: company } }));
    expect(v3.check().pending).toBe(false);
  });
});

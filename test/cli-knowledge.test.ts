import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { runKnowledge } from "../src/cli/knowledge";
import { getOrCreate, save } from "../src/tools/knowledge/lib";

const ROOT = resolve(import.meta.dir, "../.test-tmp/cli-knowledge");
const originalPalHome = process.env.PAL_HOME;

beforeAll(() => {
  process.env.PAL_HOME = ROOT;
});

afterAll(() => {
  if (originalPalHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = originalPalHome;
});

beforeEach(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
});

// Capture console.log + console.error output across a single call.
function captureOutput(): {
  flush: () => string;
  logSpy: ReturnType<typeof spyOn<typeof console, "log">>;
  errSpy: ReturnType<typeof spyOn<typeof console, "error">>;
} {
  const lines: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    lines.push(a.join(" "));
  });
  const errSpy = spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    lines.push(a.join(" "));
  });
  return {
    flush: () => lines.join("\n"),
    logSpy,
    errSpy,
  };
}

afterEach(() => {
  // Restore any console spies installed in tests
  // (spyOn auto-restores on afterEach in newer bun versions; safe regardless)
});

function fixture(): void {
  getOrCreate({
    domain: "Companies",
    name: "Acme Labs",
    tags: ["ai", "research"],
    body: "Founded 2022. Focus on retrieval.",
  });
  getOrCreate({
    domain: "Companies",
    name: "Beta Corp",
    tags: ["ai"],
  });
  getOrCreate({
    domain: "People",
    name: "Alice Example",
    tags: ["ai"],
    related: [{ slug: "acme-labs", type: "part-of" }],
    body: "Alice researches widgets at Acme.",
  });
  getOrCreate({
    domain: "People",
    name: "Bob Example",
    tags: ["ml"],
    related: [{ slug: "beta-corp", type: "part-of" }],
    body: "Bob works on neural nets.",
  });
  getOrCreate({
    domain: "Ideas",
    name: "Widget Theory",
    tags: ["theory"],
    related: [{ slug: "alice-example", type: "supports" }],
    body: "A theory about widgets.",
  });
}

// ── dispatcher ─────────────────────────────────────────────────────

describe("dispatcher", () => {
  test("no args prints help", async () => {
    const cap = captureOutput();
    const code = await runKnowledge([]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(0);
    expect(cap.flush()).toContain("Usage:");
    expect(cap.flush()).toContain("subcommand");
  });

  test("unknown subcommand → exit 1, prints help", async () => {
    const cap = captureOutput();
    const code = await runKnowledge(["bogus"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(1);
    expect(cap.flush()).toContain("Unknown subcommand");
  });

  test("help works", async () => {
    const cap = captureOutput();
    const code = await runKnowledge(["help"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(0);
    expect(cap.flush()).toContain("search");
  });
});

// ── search ─────────────────────────────────────────────────────────

describe("search", () => {
  test("missing query → exit 1", async () => {
    const cap = captureOutput();
    const code = await runKnowledge(["search"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(1);
    expect(cap.flush()).toContain("Usage");
  });

  test("returns hits ranked by score", async () => {
    fixture();
    const cap = captureOutput();
    const code = await runKnowledge(["search", "acme"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(0);
    const out = cap.flush();
    expect(out).toContain("acme-labs"); // slug match (score 5)
    expect(out).toContain("alice-example"); // body match (score 1)
  });

  test("no matches yields helpful message", async () => {
    fixture();
    const cap = captureOutput();
    await runKnowledge(["search", "nonexistent"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(cap.flush()).toContain("No matches");
  });
});

// ── graph ──────────────────────────────────────────────────────────

describe("graph", () => {
  test("traverses 1 hop and lists neighbors", async () => {
    fixture();
    const cap = captureOutput();
    const code = await runKnowledge(["graph", "alice", "--hops", "1"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(0);
    const out = cap.flush();
    expect(out).toContain("alice-example");
    expect(out).toContain("acme-labs"); // related: part-of
  });

  test("unknown slug → exit 1", async () => {
    fixture();
    const cap = captureOutput();
    const code = await runKnowledge(["graph", "ghost"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(1);
  });

  test("missing slug → exit 1", async () => {
    const cap = captureOutput();
    const code = await runKnowledge(["graph"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(1);
  });
});

// ── stats ──────────────────────────────────────────────────────────

describe("stats", () => {
  test("prints counts", async () => {
    fixture();
    const cap = captureOutput();
    const code = await runKnowledge(["stats"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(0);
    const out = cap.flush();
    expect(out).toContain("Nodes: 5");
    expect(out).toContain("People");
    expect(out).toContain("Companies");
  });
});

// ── hubs ───────────────────────────────────────────────────────────

describe("hubs", () => {
  test("lists hubs by connection count", async () => {
    fixture();
    const cap = captureOutput();
    const code = await runKnowledge(["hubs"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(0);
    expect(cap.flush()).toContain("Top hubs");
  });

  test("empty graph still works", async () => {
    const cap = captureOutput();
    const code = await runKnowledge(["hubs"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(0);
    expect(cap.flush()).toContain("no connected nodes");
  });
});

// ── find ───────────────────────────────────────────────────────────

describe("find", () => {
  test("missing tag → exit 1", async () => {
    const cap = captureOutput();
    const code = await runKnowledge(["find"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(1);
  });

  test("filters by tag", async () => {
    fixture();
    const cap = captureOutput();
    await runKnowledge(["find", "ai"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    const out = cap.flush();
    expect(out).toContain("acme-labs");
    expect(out).toContain("beta-corp");
    expect(out).toContain("alice-example");
    expect(out).not.toContain("bob-example"); // tagged "ml", not "ai"
  });
});

// ── show ───────────────────────────────────────────────────────────

describe("show", () => {
  test("prints entity frontmatter + body", async () => {
    fixture();
    const cap = captureOutput();
    const code = await runKnowledge(["show", "alice"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(0);
    const out = cap.flush();
    expect(out).toContain("alice-example");
    expect(out).toContain("Alice Example");
    expect(out).toContain("Alice researches widgets");
    expect(out).toContain("part-of");
    expect(out).toContain("acme-labs");
  });

  test("unknown slug → exit 1", async () => {
    fixture();
    const cap = captureOutput();
    const code = await runKnowledge(["show", "ghost"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(1);
  });
});

// ── add (flag-only mode) ───────────────────────────────────────────

describe("add — flag-only mode", () => {
  test("creates entity with tags + related flags", async () => {
    const cap = captureOutput();
    const code = await runKnowledge([
      "add",
      "People",
      "Charlie Test",
      "--tags",
      "ai,research",
      "--related",
      "acme-labs:supports",
      "--quality",
      "7",
      "--status",
      "budding",
    ]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(0);
    expect(cap.flush()).toContain("People/charlie-test");

    const cap2 = captureOutput();
    await runKnowledge(["show", "charlie-test"]);
    cap2.logSpy.mockRestore();
    cap2.errSpy.mockRestore();
    const shown = cap2.flush();
    expect(shown).toContain('"ai"');
    expect(shown).toContain('"research"');
    expect(shown).toContain('"budding"');
    expect(shown).toContain("supports");
    expect(shown).toContain("acme-labs");
  });

  test("rejects bad domain", async () => {
    const cap = captureOutput();
    const code = await runKnowledge(["add", "Animals", "Foo"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(1);
  });

  test("rejects bad relation type", async () => {
    const cap = captureOutput();
    const code = await runKnowledge([
      "add",
      "People",
      "Diane Test",
      "--related",
      "acme-labs:knows",
    ]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(1);
  });

  test("rejects quality out of range", async () => {
    const cap = captureOutput();
    const code = await runKnowledge(["add", "People", "Eve Test", "--quality", "11"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(1);
  });
});

// ── ls ─────────────────────────────────────────────────────────────

describe("ls", () => {
  test("lists all entities", async () => {
    fixture();
    const cap = captureOutput();
    const code = await runKnowledge(["ls"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(0);
    const out = cap.flush();
    expect(out).toContain("5 entities");
    expect(out).toContain("alice-example");
    expect(out).toContain("widget-theory");
  });

  test("filters by domain", async () => {
    fixture();
    const cap = captureOutput();
    await runKnowledge(["ls", "People"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    const out = cap.flush();
    expect(out).toContain("alice-example");
    expect(out).toContain("bob-example");
    expect(out).not.toContain("acme-labs"); // Company, not listed
  });

  test("rejects bad domain", async () => {
    const cap = captureOutput();
    const code = await runKnowledge(["ls", "Animals"]);
    cap.logSpy.mockRestore();
    cap.errSpy.mockRestore();
    expect(code).toBe(1);
  });
});

// ── PAL_HOME sandboxing ────────────────────────────────────────────

describe("PAL_HOME sandboxing", () => {
  test("save() respects PAL_HOME (no leak to real ~/.pal)", () => {
    fixture();
    // Sanity: file lives under our ROOT
    const aliceFile = resolve(ROOT, "memory/knowledge/People/alice-example.md");
    expect(existsSync(aliceFile)).toBe(true);
    // And the save() reference is intact (no shadowing)
    expect(typeof save).toBe("function");
  });
});

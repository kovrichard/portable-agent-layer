import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-retrieval");

beforeAll(() => {
  process.env.PAL_HOME = TEST_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

beforeEach(() => {
  for (const dir of [
    resolve(TEST_HOME, "memory", "learning", "failures"),
    resolve(TEST_HOME, "memory", "wisdom", "frames"),
  ]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }
  const indexPath = resolve(TEST_HOME, "memory", "learning", ".retrieval-index.json");
  if (existsSync(indexPath)) rmSync(indexPath);
});

function fixtureCapture(
  yyyymm: string,
  slug: string,
  meta: { rating: number; context: string; principle: string; ts: string },
  body = ""
) {
  const dir = resolve(
    TEST_HOME,
    "memory",
    "learning",
    "failures",
    ...yyyymm.split("/"),
    slug
  );
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---",
    `rating: ${meta.rating}`,
    `context: "${meta.context}"`,
    `principle: "${meta.principle}"`,
    `ts: ${meta.ts}`,
    `slug: ${slug}`,
    "---",
    "",
    body,
  ].join("\n");
  writeFileSync(resolve(dir, "capture.md"), fm);
}

function fixtureFrame(domain: string, principle: string, pct: number) {
  const dir = resolve(TEST_HOME, "memory", "wisdom", "frames");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, `${domain}.md`),
    `# ${domain}\n\n- ${principle} [CRYSTAL: ${pct}%]\n`
  );
}

async function freshLib() {
  const t = Date.now();
  const idx = await import(`../src/hooks/lib/retrieval-index.ts?t=${t}`);
  const ret = await import(`../src/hooks/lib/retrieval.ts?t=${t}`);
  return { ...idx, ...ret } as typeof import("../src/hooks/lib/retrieval-index") &
    typeof import("../src/hooks/lib/retrieval");
}

describe("retrieval index — build + read", () => {
  test("buildIndex over empty corpus returns zero docs", async () => {
    const lib = await freshLib();
    const idx = lib.buildIndex();
    expect(idx.corpusSize).toBe(0);
    expect(idx.docs).toEqual([]);
  });

  test("buildIndex tokenizes failures + frames with weighted fields", async () => {
    fixtureCapture(
      "2026/04",
      "20260415-100000_database-migration-broke-prod",
      {
        rating: 3,
        context: "User got burned by mocked database tests passing in CI",
        principle: "Never mock the database in integration tests",
        ts: "2026-04-15T10:00:00Z",
      },
      "## What Happened\nMigration script ran fine in test but failed in prod due to mocked schema.\n"
    );
    fixtureFrame("development", "Always run migrations against a real database", 90);

    const lib = await freshLib();
    const idx = lib.buildIndex();
    expect(idx.corpusSize).toBe(2);
    expect(idx.docs.find((d) => d.source === "failure")?.tf.database).toBeGreaterThan(0);
    expect(idx.docs.find((d) => d.source === "wisdom")?.displayContext).toBe(
      "development"
    );
  });
});

describe("retrieval ranker — correctness", () => {
  test("ranks the lexically-overlapping doc highest", async () => {
    fixtureCapture("2026/04", "20260410-090000_typo-in-doc", {
      rating: 4,
      context: "Fixed a typo in README",
      principle: "Run spell-check before pushing docs",
      ts: "2026-04-10T09:00:00Z",
    });
    fixtureCapture("2026/04", "20260420-090000_database-mock-leak", {
      rating: 2,
      context: "Mocked database hid migration bug",
      principle: "Never mock the database in integration tests",
      ts: "2026-04-20T09:00:00Z",
    });
    const lib = await freshLib();
    const idx = lib.buildIndex();
    const result = lib.runRetrieval(
      "should I mock the database in this integration test?",
      idx,
      "/tmp"
    );
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].doc.id).toContain("database-mock-leak");
    expect(result.reminder).toContain("Never mock the database");
  });

  test("rejects below-threshold matches — empty reminder for unrelated query", async () => {
    fixtureCapture("2026/04", "20260410-090000_typo-in-doc", {
      rating: 4,
      context: "Fixed a typo in README",
      principle: "Run spell-check before pushing docs",
      ts: "2026-04-10T09:00:00Z",
    });
    const lib = await freshLib();
    const idx = lib.buildIndex();
    const result = lib.runRetrieval(
      "deploy kubernetes cluster autoscaler manifests",
      idx,
      "/tmp"
    );
    // Demonstrate, don't assert: the rejection logic must fire on a deliberately-unrelated query
    expect(result.matches).toEqual([]);
    expect(result.reminder).toBe("");
  });

  test("project-scope boost surfaces project-tagged docs", async () => {
    fixtureCapture("2026/04", "20260415-100000_pal-deploy-issue", {
      rating: 3,
      context: "PAL hook handler regressed",
      principle: "Test PAL hooks in isolation before wiring",
      ts: "2026-04-15T10:00:00Z",
    });
    fixtureCapture("2026/04", "20260416-100000_other-deploy-issue", {
      rating: 3,
      context: "Some other repo had a deploy regression",
      principle: "Test deploy scripts in isolation before wiring",
      ts: "2026-04-16T10:00:00Z",
    });
    const lib = await freshLib();
    const idx = lib.buildIndex();

    const inPal = lib.runRetrieval(
      "regression in deploy handler test wiring",
      idx,
      "/Users/x/code/pal"
    );
    const palMatch = inPal.matches.find((m) => m.doc.id.includes("pal-deploy"));
    expect(palMatch?.scopeMatch).toBe(true);
    expect(inPal.matches[0].doc.id).toContain("pal-deploy");
  });

  test("formatReminder caps output below MAX_REMINDER_BYTES", async () => {
    // Stuff lots of long-keyword captures; ensure block stays ≤500 bytes
    for (let i = 0; i < 5; i++) {
      fixtureCapture("2026/04", `2026041${i}-100000_long-principle-${i}`, {
        rating: 3,
        context: `Verbose context paragraph number ${i} about distributed systems consensus`,
        principle:
          "Always verify consensus before assuming distributed system state — quorum reads avoid split-brain reads under partition",
        ts: `2026-04-1${i}T10:00:00Z`,
      });
    }
    const lib = await freshLib();
    const idx = lib.buildIndex();
    const result = lib.runRetrieval(
      "distributed consensus quorum reads partition split-brain",
      idx,
      "/tmp"
    );
    expect(result.reminder.length).toBeLessThanOrEqual(500);
  });
});

describe("retrieval index — dedup against graduated frames", () => {
  test("excludes failures whose principle has graduated to a wisdom frame", async () => {
    fixtureCapture("2026/04", "20260415-100000_clarify-intent", {
      rating: 3,
      context: "User had to repeat the requirement twice",
      principle: "Always clarify intent before delivering",
      ts: "2026-04-15T10:00:00Z",
    });
    fixtureCapture("2026/04", "20260420-100000_unrelated", {
      rating: 2,
      context: "Kubernetes pod kept crashing on init",
      principle: "Verify pod readiness probes match container startup time",
      ts: "2026-04-20T10:00:00Z",
    });
    // The "clarify intent" capture has a Dice-similar twin in the graduated frame
    fixtureFrame("communication", "Always clarify intent before answering", 90);

    const lib = await freshLib();
    const idx = lib.buildIndex();

    const ids = idx.docs.map((d) => d.id);
    expect(ids).not.toContain("20260415-100000_clarify-intent");
    expect(ids.some((id) => id.includes("unrelated"))).toBe(true);
    expect(idx.docs.find((d) => d.source === "wisdom")?.displayPrinciple).toContain(
      "clarify intent"
    );
  });

  test("keeps failures with principles dissimilar to all frames", async () => {
    fixtureCapture("2026/04", "20260415-100000_kafka-lag", {
      rating: 3,
      context: "Kafka consumer lag spiked under load",
      principle: "Pin consumer group offsets explicitly during failover scenarios",
      ts: "2026-04-15T10:00:00Z",
    });
    fixtureFrame("communication", "Always clarify intent before answering", 90);

    const lib = await freshLib();
    const idx = lib.buildIndex();
    expect(idx.docs.some((d) => d.id.includes("kafka-lag"))).toBe(true);
  });

  test("keeps failures with no principle field", async () => {
    fixtureCapture("2026/04", "20260415-100000_no-principle", {
      rating: 3,
      context: "Some failure context",
      principle: "",
      ts: "2026-04-15T10:00:00Z",
    });
    fixtureFrame("communication", "Always clarify intent before answering", 90);

    const lib = await freshLib();
    const idx = lib.buildIndex();
    expect(idx.docs.some((d) => d.id.includes("no-principle"))).toBe(true);
  });
});

describe("retrieval index — staleness", () => {
  test("isStale flags index when failures dir is newer than index", async () => {
    fixtureCapture("2026/04", "20260415-100000_initial", {
      rating: 3,
      context: "initial capture",
      principle: "first principle",
      ts: "2026-04-15T10:00:00Z",
    });
    const lib = await freshLib();
    const idx = lib.buildIndex();
    // Force index "older" than the dir by pinning builtAt to 1970
    const stale = { ...idx, builtAt: "1970-01-01T00:00:00Z" };
    expect(lib.isStale(stale)).toBe(true);
  });

  test("ensureIndex builds + writes when missing", async () => {
    fixtureCapture("2026/04", "20260415-100000_initial", {
      rating: 3,
      context: "initial",
      principle: "first principle",
      ts: "2026-04-15T10:00:00Z",
    });
    const lib = await freshLib();
    const idx = lib.ensureIndex();
    expect(idx.corpusSize).toBe(1);
    const onDisk = lib.readIndex();
    expect(onDisk?.corpusSize).toBe(1);
  });
});

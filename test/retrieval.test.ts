import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { runRetrieval } from "../src/hooks/lib/retrieval";
import {
  buildIndex,
  ensureIndex,
  isStale,
  readIndex,
} from "../src/hooks/lib/retrieval-index";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const TEST_HOME = testHome(import.meta.file);
const FIXTURES_WRITTEN = Date.parse("2026-06-01T00:00:00Z");

function sameAgeToday(writtenAs: string): string {
  return new Date(Date.now() - (FIXTURES_WRITTEN - Date.parse(writtenAs))).toISOString();
}

beforeAll(() => {
  process.env.PAL_HOME = TEST_HOME;
  removeOnceReleased(TEST_HOME);
  mkdirSync(TEST_HOME, { recursive: true });
});

afterAll(() => {
  delete process.env.PAL_HOME;
  removeOnceReleased(TEST_HOME);
});

beforeEach(() => {
  for (const dir of [
    resolve(TEST_HOME, "memory", "learning", "failures"),
    resolve(TEST_HOME, "memory", "learning", "reflections"),
    resolve(TEST_HOME, "memory", "wisdom", "frames"),
  ]) {
    removeOnceReleased(dir);
  }
  const indexPath = resolve(TEST_HOME, "memory", "learning", ".retrieval-index.json");
  removeOnceReleased(indexPath);
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

function fixtureReflection(entry: {
  timestamp: string;
  cwd: string;
  task: string;
  sentiment: number;
  q1: string;
  q2?: string;
  q3?: string;
}) {
  const dir = resolve(TEST_HOME, "memory", "learning", "reflections");
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    resolve(dir, "algorithm-reflections.jsonl"),
    `${JSON.stringify({ q2: "", q3: "", ...entry })}\n`
  );
}

describe("retrieval index — build + read", () => {
  test("buildIndex over empty corpus returns zero docs", () => {
    const idx = buildIndex();
    expect(idx.corpusSize).toBe(0);
    expect(idx.docs).toEqual([]);
  });

  test("buildIndex tokenizes failures + frames with weighted fields", () => {
    fixtureCapture(
      "2026/04",
      "20260415-100000_database-migration-broke-prod",
      {
        rating: 3,
        context: "User got burned by mocked database tests passing in CI",
        principle: "Never mock the database in integration tests",
        ts: sameAgeToday("2026-04-15T10:00:00Z"),
      },
      "## What Happened\nMigration script ran fine in test but failed in prod due to mocked schema.\n"
    );
    fixtureFrame("development", "Always run migrations against a real database", 90);

    const idx = buildIndex();
    expect(idx.corpusSize).toBe(2);
    expect(idx.docs.find((d) => d.source === "failure")?.tf.database).toBeGreaterThan(0);
    expect(idx.docs.find((d) => d.source === "wisdom")?.displayContext).toBe(
      "development"
    );
  });
});

describe("retrieval ranker — correctness", () => {
  test("ranks the lexically-overlapping doc highest", () => {
    fixtureCapture("2026/04", "20260410-090000_typo-in-doc", {
      rating: 4,
      context: "Fixed a typo in README",
      principle: "Run spell-check before pushing docs",
      ts: sameAgeToday("2026-04-10T09:00:00Z"),
    });
    fixtureCapture("2026/04", "20260420-090000_database-mock-leak", {
      rating: 2,
      context: "Mocked database hid migration bug",
      principle: "Never mock the database in integration tests",
      ts: sameAgeToday("2026-04-20T09:00:00Z"),
    });
    const idx = buildIndex();
    const result = runRetrieval(
      "should I mock the database in this integration test?",
      idx,
      "/tmp"
    );
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].doc.id).toContain("database-mock-leak");
    expect(result.reminder).toContain("Never mock the database");
  });

  test("rejects below-threshold matches — empty reminder for unrelated query", () => {
    fixtureCapture("2026/04", "20260410-090000_typo-in-doc", {
      rating: 4,
      context: "Fixed a typo in README",
      principle: "Run spell-check before pushing docs",
      ts: sameAgeToday("2026-04-10T09:00:00Z"),
    });
    const idx = buildIndex();
    const result = runRetrieval(
      "deploy kubernetes cluster autoscaler manifests",
      idx,
      "/tmp"
    );
    expect(result.matches).toEqual([]);
    expect(result.reminder).toBe("");
  });

  test("project-scope boost surfaces project-tagged docs", () => {
    fixtureCapture("2026/04", "20260415-100000_pal-deploy-issue", {
      rating: 3,
      context: "PAL hook handler regressed",
      principle: "Test PAL hooks in isolation before wiring",
      ts: sameAgeToday("2026-04-15T10:00:00Z"),
    });
    fixtureCapture("2026/04", "20260416-100000_other-deploy-issue", {
      rating: 3,
      context: "Some other repo had a deploy regression",
      principle: "Test deploy scripts in isolation before wiring",
      ts: sameAgeToday("2026-04-16T10:00:00Z"),
    });
    const idx = buildIndex();

    const inPal = runRetrieval(
      "regression in deploy handler test wiring",
      idx,
      "/Users/x/code/pal"
    );
    const palMatch = inPal.matches.find((m) => m.doc.id.includes("pal-deploy"));
    expect(palMatch?.scopeMatch).toBe(true);
    expect(inPal.matches[0].doc.id).toContain("pal-deploy");
  });

  test("formatReminder caps output below MAX_REMINDER_BYTES", () => {
    for (let i = 0; i < 5; i++) {
      fixtureCapture("2026/04", `2026041${i}-100000_long-principle-${i}`, {
        rating: 3,
        context: `Verbose context paragraph number ${i} about distributed systems consensus`,
        principle:
          "Always verify consensus before assuming distributed system state — quorum reads avoid split-brain reads under partition",
        ts: sameAgeToday(`2026-04-1${i}T10:00:00Z`),
      });
    }
    const idx = buildIndex();
    const result = runRetrieval(
      "distributed consensus quorum reads partition split-brain",
      idx,
      "/tmp"
    );
    expect(result.reminder.length).toBeLessThanOrEqual(500);
  });
});

describe("retrieval index — dedup against graduated frames", () => {
  test("excludes failures whose principle has graduated to a wisdom frame", () => {
    fixtureCapture("2026/04", "20260415-100000_clarify-intent", {
      rating: 3,
      context: "User had to repeat the requirement twice",
      principle: "Always clarify intent before delivering",
      ts: sameAgeToday("2026-04-15T10:00:00Z"),
    });
    fixtureCapture("2026/04", "20260420-100000_unrelated", {
      rating: 2,
      context: "Kubernetes pod kept crashing on init",
      principle: "Verify pod readiness probes match container startup time",
      ts: sameAgeToday("2026-04-20T10:00:00Z"),
    });
    fixtureFrame("communication", "Always clarify intent before answering", 90);

    const idx = buildIndex();

    const ids = idx.docs.map((d) => d.id);
    expect(ids).not.toContain("20260415-100000_clarify-intent");
    expect(ids.some((id) => id.includes("unrelated"))).toBe(true);
    expect(idx.docs.find((d) => d.source === "wisdom")?.displayPrinciple).toContain(
      "clarify intent"
    );
  });

  test("keeps failures with principles dissimilar to all frames", () => {
    fixtureCapture("2026/04", "20260415-100000_kafka-lag", {
      rating: 3,
      context: "Kafka consumer lag spiked under load",
      principle: "Pin consumer group offsets explicitly during failover scenarios",
      ts: sameAgeToday("2026-04-15T10:00:00Z"),
    });
    fixtureFrame("communication", "Always clarify intent before answering", 90);

    const idx = buildIndex();
    expect(idx.docs.some((d) => d.id.includes("kafka-lag"))).toBe(true);
  });

  test("keeps failures with no principle field", () => {
    fixtureCapture("2026/04", "20260415-100000_no-principle", {
      rating: 3,
      context: "Some failure context",
      principle: "",
      ts: sameAgeToday("2026-04-15T10:00:00Z"),
    });
    fixtureFrame("communication", "Always clarify intent before answering", 90);

    const idx = buildIndex();
    expect(idx.docs.some((d) => d.id.includes("no-principle"))).toBe(true);
  });
});

describe("retrieval index — anchored cwd (cross-machine scope)", () => {
  function fixtureProject(name: string, path: string) {
    const dir = resolve(TEST_HOME, "memory", "projects", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "ISA.md"),
      `---\nname: "${name}"\npath: "${path}"\nstatus: "active"\ncreated: "2026-01-01"\nupdated: "2026-01-01"\n---\n\n## Goal\n`
    );
  }

  test("an anchored reflection scope-matches against the LOCAL registered path, not the path it was captured under", () => {
    // Registered here at a path different from wherever it was captured —
    // exactly what happens after an import from another machine.
    fixtureProject("sample", "/opt/build/sample");
    fixtureReflection({
      timestamp: sameAgeToday("2026-05-30T18:00:00Z"),
      cwd: "{proj:sample}/src",
      task: "Build the playwright visual-check skill",
      sentiment: 8,
      q1: "Verify the external tool's exact CLI contract before hardcoding the screenshot command",
    });
    const idx = buildIndex();
    const result = runRetrieval(
      "what is the exact CLI contract for this screenshot binary?",
      idx,
      "/opt/build/sample/src"
    );
    expect(result.matches[0].scopeMatch).toBe(true);
  });

  test("does not scope-match a different local cwd under the same project", () => {
    fixtureProject("sample", "/opt/build/sample");
    fixtureReflection({
      timestamp: sameAgeToday("2026-05-30T18:00:00Z"),
      cwd: "{proj:sample}/src",
      task: "Build the playwright visual-check skill",
      sentiment: 8,
      q1: "Verify the external tool's exact CLI contract before hardcoding the screenshot command",
    });
    const idx = buildIndex();
    const result = runRetrieval(
      "what is the exact CLI contract for this screenshot binary?",
      idx,
      "/opt/build/sample/test"
    );
    expect(result.matches[0]?.scopeMatch ?? false).toBe(false);
  });

  test("an anchor whose project is not registered here never scope-matches", () => {
    // No fixtureProject call — the slug is unknown on this "machine".
    fixtureReflection({
      timestamp: sameAgeToday("2026-05-30T18:00:00Z"),
      cwd: "{proj:gizmo}/src",
      task: "Build the playwright visual-check skill",
      sentiment: 8,
      q1: "Verify the external tool's exact CLI contract before hardcoding the screenshot command",
    });
    const idx = buildIndex();
    const result = runRetrieval(
      "what is the exact CLI contract for this screenshot binary?",
      idx,
      "/opt/build/gizmo/src"
    );
    expect(result.matches[0]?.scopeMatch ?? false).toBe(false);
  });
});

describe("retrieval index — reflections", () => {
  test("indexes reflections with q1 as the displayed principle", () => {
    fixtureReflection({
      timestamp: sameAgeToday("2026-05-30T18:00:00Z"),
      cwd: "/Users/x/code/pal",
      task: "Build the playwright visual-check skill",
      sentiment: 8,
      q1: "Verify the external tool's exact CLI contract before hardcoding the screenshot command",
      q2: "Add a verify-CLI-contract step when a tier depends on a third-party binary",
    });
    const idx = buildIndex();
    const doc = idx.docs.find((d) => d.source === "reflection");
    expect(doc).toBeDefined();
    expect(doc?.displayPrinciple).toContain("CLI contract");
    expect(doc?.cwd).toBe("/Users/x/code/pal");
    expect(doc?.rating).toBe(8);
  });

  test("surfaces a reflection on a lexically-matching query, labeled as a reflection", () => {
    fixtureReflection({
      timestamp: sameAgeToday("2026-05-30T18:00:00Z"),
      cwd: "/Users/x/code/pal",
      task: "Build the playwright visual-check skill",
      sentiment: 8,
      q1: "Verify the external tool's exact CLI contract before hardcoding the screenshot command",
    });
    const idx = buildIndex();
    const result = runRetrieval(
      "what is the exact CLI contract for this screenshot binary?",
      idx,
      "/Users/x/code/pal"
    );
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].doc.source).toBe("reflection");
    expect(result.matches[0].scopeMatch).toBe(true);
    expect(result.reminder).toContain("reflection 8/10");
  });

  test("isStale flags index when the reflections store is newer", () => {
    fixtureReflection({
      timestamp: sameAgeToday("2026-05-30T18:00:00Z"),
      cwd: "/Users/x/code/pal",
      task: "Some task",
      sentiment: 7,
      q1: "Some reflection",
    });
    const idx = buildIndex();
    const stale = { ...idx, builtAt: "1970-01-01T00:00:00Z" };
    expect(isStale(stale)).toBe(true);
  });
});

describe("retrieval index — staleness", () => {
  test("isStale flags index when failures dir is newer than index", () => {
    fixtureCapture("2026/04", "20260415-100000_initial", {
      rating: 3,
      context: "initial capture",
      principle: "first principle",
      ts: sameAgeToday("2026-04-15T10:00:00Z"),
    });
    const idx = buildIndex();
    const stale = { ...idx, builtAt: "1970-01-01T00:00:00Z" };
    expect(isStale(stale)).toBe(true);
  });

  const BUILT = "2026-09-01T00:00:00Z";

  function ageEveryDirectory(root: string) {
    const old = new Date("2026-08-01T00:00:00Z");
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (entry.isDirectory())
        utimesSync(resolve(entry.parentPath, entry.name), old, old);
    }
    utimesSync(root, old, old);
  }

  function touchAfterBuild(file: string) {
    const later = new Date("2026-09-02T00:00:00Z");
    utimesSync(file, later, later);
  }

  test("isStale sees a capture added inside an existing month folder", () => {
    fixtureCapture("2026/04", "20260415-100000_initial", {
      rating: 3,
      context: "initial capture",
      principle: "first principle",
      ts: sameAgeToday("2026-04-15T10:00:00Z"),
    });
    const idx = { ...buildIndex(), builtAt: BUILT };
    ageEveryDirectory(resolve(TEST_HOME, "memory"));
    touchAfterBuild(
      resolve(
        TEST_HOME,
        "memory/learning/failures/2026/04/20260415-100000_initial/capture.md"
      )
    );

    expect(isStale(idx)).toBe(true);
  });

  test("isStale sees a reflection appended to the existing store", () => {
    fixtureReflection({
      timestamp: sameAgeToday("2026-05-30T18:00:00Z"),
      cwd: "/Users/x/code/pal",
      task: "Some task",
      sentiment: 7,
      q1: "Some reflection",
    });
    const idx = { ...buildIndex(), builtAt: BUILT };
    ageEveryDirectory(resolve(TEST_HOME, "memory"));
    touchAfterBuild(
      resolve(TEST_HOME, "memory/learning/reflections/algorithm-reflections.jsonl")
    );

    expect(isStale(idx)).toBe(true);
  });

  test("isStale holds a fresh index when nothing changed after the build", () => {
    fixtureCapture("2026/04", "20260415-100000_initial", {
      rating: 3,
      context: "initial capture",
      principle: "first principle",
      ts: sameAgeToday("2026-04-15T10:00:00Z"),
    });
    const idx = { ...buildIndex(), builtAt: BUILT };
    const old = new Date("2026-08-01T00:00:00Z");
    for (const entry of readdirSync(resolve(TEST_HOME, "memory"), {
      recursive: true,
      withFileTypes: true,
    })) {
      utimesSync(resolve(entry.parentPath, entry.name), old, old);
    }

    expect(isStale(idx)).toBe(false);
  });

  test("ensureIndex builds + writes when missing", () => {
    fixtureCapture("2026/04", "20260415-100000_initial", {
      rating: 3,
      context: "initial",
      principle: "first principle",
      ts: sameAgeToday("2026-04-15T10:00:00Z"),
    });
    const idx = ensureIndex();
    expect(idx.corpusSize).toBe(1);
    const onDisk = readIndex();
    expect(onDisk?.corpusSize).toBe(1);
  });
});

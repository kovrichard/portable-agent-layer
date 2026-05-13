import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-project-cli");
const CLI = resolve(import.meta.dir, "../src/tools/agent/project.ts");

beforeAll(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

beforeEach(() => {
  const isaDir = resolve(TEST_HOME, "memory", "projects");
  if (existsSync(isaDir)) rmSync(isaDir, { recursive: true });
  const legacyDir = resolve(TEST_HOME, "memory", "state", "progress");
  if (existsSync(legacyDir)) rmSync(legacyDir, { recursive: true });
});

async function runCli(
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    env: { ...process.env, PAL_HOME: TEST_HOME },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

function isaFiles(): string[] {
  const base = resolve(TEST_HOME, "memory", "projects");
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((slug) => existsSync(resolve(base, slug, "ISA.md")));
}

describe("project CLI", () => {
  test("help prints usage", async () => {
    const r = await runCli(["help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Project — manage PAL project state");
    expect(r.stdout).toContain("create");
    expect(r.stdout).toContain("update-section");
  });

  test("create with explicit name + path → writes ISA.md", async () => {
    const r = await runCli(["create", "pal", "--path", "/tmp/pal-fake"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.created).toBe(true);
    expect(out.project.name).toBe("pal");
    expect(out.project.status).toBe("active");
    expect(isaFiles()).toContain("pal");
  });

  test("create defaults the name to basename of cwd (full segment, NOT split)", async () => {
    const fakeRepo = resolve(TEST_HOME, "portable-agent-layer-fixture");
    mkdirSync(fakeRepo, { recursive: true });
    const proc = Bun.spawn(["bun", "run", CLI, "create"], {
      cwd: fakeRepo,
      env: { ...process.env, PAL_HOME: TEST_HOME },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const out = JSON.parse(stdout);
    expect(out.project.name).toBe("portable-agent-layer-fixture");
  });

  test("create rejects duplicate names", async () => {
    await runCli(["create", "dup", "--path", "/tmp/x"]);
    const r = await runCli(["create", "dup", "--path", "/tmp/x"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("already exists");
  });

  test("list shows created projects", async () => {
    await runCli(["create", "alpha", "--path", "/tmp/a"]);
    await runCli(["create", "beta", "--path", "/tmp/b"]);
    const r = await runCli(["list"]);
    const out = JSON.parse(r.stdout);
    expect(out.count).toBe(2);
    expect(out.projects.map((p: { name: string }) => p.name).sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });

  test("update-section sets a body section, round-trips via resume", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    const r = await runCli(["update-section", "p", "goal", "Ship Tier 1"]);
    expect(r.code).toBe(0);
    const got = JSON.parse(r.stdout);
    expect(got.updated).toBe(true);
    const list = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(list.project.goal).toBe("Ship Tier 1");
  });

  test("update-section sets context section", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    const r = await runCli(["update-section", "p", "context", "PAI source: /repos/pai"]);
    expect(r.code).toBe(0);
    const got = JSON.parse(r.stdout);
    expect(got.section).toBe("context");
    const list = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(list.project.context).toBe("PAI source: /repos/pai");
  });

  test("add-decision appends dated entry to decisions section", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    await runCli(["add-decision", "p", "use-bm25", "small-corpus-makes-it-fine"]);
    const r = await runCli(["resume", "p"]);
    const got = JSON.parse(r.stdout);
    expect(got.project.decisions).toContain("use-bm25");
    expect(got.project.decisions).toContain("small-corpus-makes-it-fine");
  });

  test("add-decision appends multiple dated entries", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    await runCli(["add-decision", "p", "decision-one", "reason-one"]);
    await runCli(["add-decision", "p", "decision-two", "reason-two"]);
    const r = await runCli(["resume", "p"]);
    const got = JSON.parse(r.stdout);
    expect(got.project.decisions).toContain("decision-one");
    expect(got.project.decisions).toContain("decision-two");
  });

  test("status transitions: complete / archive / pause / unpause", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    let r = await runCli(["pause", "p"]);
    expect(JSON.parse(r.stdout).status).toBe("paused");
    r = await runCli(["unpause", "p"]);
    expect(JSON.parse(r.stdout).status).toBe("active");
    r = await runCli(["complete", "p"]);
    expect(JSON.parse(r.stdout).status).toBe("complete");
    r = await runCli(["archive", "p"]);
    expect(JSON.parse(r.stdout).status).toBe("archived");
  });

  test("add-next appends and persists count", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    const r = await runCli(["add-next", "p", "Ship", "Tier", "1"]);
    expect(r.code).toBe(0);
    const got = JSON.parse(r.stdout);
    expect(got.updated).toBe(true);
    expect(got.count).toBe(1);
    const list = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(list.project.next).toEqual(["Ship Tier 1"]);
  });

  test("rm-next by index removes the right entry", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    await runCli(["add-next", "p", "first-next"]);
    await runCli(["add-next", "p", "second-next"]);
    const r = await runCli(["rm-next", "p", "0"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.removed).toBe("first-next");
    const after = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(after.project.next).toEqual(["second-next"]);
  });

  test("criteria returns the criteria section", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    await runCli([
      "update-section",
      "p",
      "criteria",
      "- All tests pass\n- ISA.md written",
    ]);
    const r = await runCli(["criteria", "p"]);
    expect(r.code).toBe(0);
    const got = JSON.parse(r.stdout);
    expect(got.criteria).toContain("All tests pass");
  });

  test("migrate converts old JSON files to ISA.md and removes them", async () => {
    const oldDir = resolve(TEST_HOME, "memory", "state", "progress");
    if (!existsSync(oldDir)) mkdirSync(oldDir, { recursive: true });
    const legacy = {
      name: "legacy-proj",
      path: "/tmp/legacy",
      status: "active",
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-02T00:00:00Z",
      facts: ["ref at ~/pai"],
      objectives: ["Ship it"],
      next_steps: ["do the thing"],
      blockers: ["waiting on review"],
      handoff: "pick up at step 3",
      decisions: [
        { ts: "2026-01-01T00:00:00Z", decision: "use ISA", rationale: "clean" },
      ],
    };
    writeFileSync(resolve(oldDir, "legacy-proj.json"), JSON.stringify(legacy));

    const r = await runCli(["migrate"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.migrated).toBe(1);
    expect(out.skipped).toBe(0);

    // Old JSON removed
    expect(existsSync(resolve(oldDir, "legacy-proj.json"))).toBe(false);
    // New ISA.md created with migrated data
    expect(isaFiles()).toContain("legacy-proj");
    const resumed = JSON.parse((await runCli(["resume", "legacy-proj"])).stdout);
    expect(resumed.project.next).toEqual(["do the thing"]);
    expect(resumed.project.blockers).toEqual(["waiting on review"]);
    expect(resumed.project.handoff).toBe("pick up at step 3");
    expect(resumed.project.context).toContain("ref at ~/pai");
    expect(resumed.project.goal).toContain("Ship it");
    expect(resumed.project.decisions).toContain("use ISA");
  });

  test("migrate skips already-migrated projects", async () => {
    await runCli(["create", "existing", "--path", "/tmp/existing"]);
    const oldDir = resolve(TEST_HOME, "memory", "state", "progress");
    if (!existsSync(oldDir)) mkdirSync(oldDir, { recursive: true });
    writeFileSync(
      resolve(oldDir, "existing.json"),
      JSON.stringify({
        name: "existing",
        path: "/tmp/existing",
        status: "active",
        created: "2026-01-01T00:00:00Z",
        updated: "2026-01-01T00:00:00Z",
      })
    );
    const r = await runCli(["migrate"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.skipped).toBe(1);
    // JSON still present (not deleted since we skipped)
    expect(existsSync(resolve(oldDir, "existing.json"))).toBe(true);
  });

  test("migrate with empty old dir returns zero counts", async () => {
    const r = await runCli(["migrate"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.migrated).toBe(0);
    expect(out.skipped).toBe(0);
  });

  test("invalid name is rejected", async () => {
    const r = await runCli(["create", "Has Spaces", "--path", "/tmp/x"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Invalid project name");
  });

  test("set-path updates the registered path", async () => {
    await runCli(["create", "p", "--path", "/tmp/original"]);
    const r = await runCli(["set-path", "p", "/tmp/updated"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.updated).toBe(true);
    expect(out.path).toContain("updated");
    const after = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(after.project.path).toContain("updated");
  });

  test("unknown command exits 1 with helpful stderr", async () => {
    const r = await runCli(["frobnicate"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Unknown command");
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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
  const dir = resolve(TEST_HOME, "memory", "state", "progress");
  if (existsSync(dir)) rmSync(dir, { recursive: true });
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

function progressFiles(): string[] {
  const dir = resolve(TEST_HOME, "memory", "state", "progress");
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

describe("project CLI", () => {
  test("help prints usage", async () => {
    const r = await runCli(["help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Project — manage PAL project state");
    expect(r.stdout).toContain("create");
    expect(r.stdout).toContain("add-objective");
  });

  test("create with explicit name + path → writes JSON", async () => {
    const r = await runCli(["create", "pal", "--path", "/tmp/pal-fake"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.created).toBe(true);
    expect(out.project.name).toBe("pal");
    expect(out.project.status).toBe("active");
    expect(progressFiles()).toContain("pal.json");
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

  test("add-objective appends, updates 'updated', persists count", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    const r = await runCli(["add-objective", "p", "Ship", "Tier", "1"]);
    expect(r.code).toBe(0);
    const got = JSON.parse(r.stdout);
    expect(got.updated).toBe(true);
    expect(got.count).toBe(1);
    const list = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(list.project.objectives).toEqual(["Ship Tier 1"]);
  });

  test("add-fact appends a stable reference fact, persists count", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    const r = await runCli(["add-fact", "p", "PAI", "source:", "/repos/pai"]);
    expect(r.code).toBe(0);
    const got = JSON.parse(r.stdout);
    expect(got.field).toBe("facts");
    expect(got.count).toBe(1);
    const list = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(list.project.facts).toEqual(["PAI source: /repos/pai"]);
  });

  test("rm-fact by index removes the right entry", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    await runCli(["add-fact", "p", "first-fact"]);
    await runCli(["add-fact", "p", "second-fact"]);
    const r = await runCli(["rm-fact", "p", "0"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.removed).toBe("first-fact");
    const after = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(after.project.facts).toEqual(["second-fact"]);
  });

  test("add-decision logs ts + decision + rationale", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    await runCli(["add-decision", "p", "use-bm25", "small-corpus-makes-it-fine"]);
    const r = await runCli(["resume", "p"]);
    const got = JSON.parse(r.stdout);
    expect(got.project.decisions?.[0].decision).toBe("use-bm25");
    expect(got.project.decisions?.[0].rationale).toBe("small-corpus-makes-it-fine");
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

  test("rm-objective by index removes the right entry", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    await runCli(["add-objective", "p", "first"]);
    await runCli(["add-objective", "p", "second"]);
    const r = await runCli(["rm-objective", "p", "0"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.removed).toBe("first");
    const after = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(after.project.objectives).toEqual(["second"]);
  });

  test("invalid name is rejected", async () => {
    const r = await runCli(["create", "Has Spaces", "--path", "/tmp/x"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Invalid project name");
  });

  test("unknown command exits 1 with helpful stderr", async () => {
    const r = await runCli(["frobnicate"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Unknown command");
  });
});

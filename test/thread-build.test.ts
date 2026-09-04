import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HOME = resolve(import.meta.dir, "../.test-home-thread-build");

beforeEach(() => {
  process.env.PAL_HOME = HOME;
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  mkdirSync(HOME, { recursive: true });
});

afterEach(() => {
  delete process.env.PAL_HOME;
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

async function lib() {
  return await import("../src/tools/agent/thread");
}

describe("addThread", () => {
  test("stamps this machine's id", async () => {
    const { addThread } = await lib();
    const t = addThread("a title", "some context");
    const machineFile = JSON.parse(readFileSync(resolve(HOME, "machine.json"), "utf-8"));
    expect(t.machine).toBe(machineFile.id);
  });

  test("anchors the cwd when it falls inside a registered project", async () => {
    const slug = "test-repo";
    const dir = resolve(HOME, "memory", "projects", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "ISA.md"),
      `---\nname: "${slug}"\npath: "${process.cwd()}"\nstatus: "active"\ncreated: "2026-01-01"\nupdated: "2026-01-01"\n---\n\n## Goal\n`
    );
    const { addThread } = await lib();
    const t = addThread("a title", "some context");
    expect(t.cwd).toBe(`{proj:${slug}}`);
  });

  test("passes the cwd through unchanged when no project is registered", async () => {
    const { addThread } = await lib();
    const t = addThread("a title", "some context");
    expect(t.cwd).toBe(process.cwd());
  });

  test("persists the stamped thread to threads.jsonl", async () => {
    const { addThread } = await lib();
    const t = addThread("a title", "some context");
    const lines = readFileSync(resolve(HOME, "memory", "state", "threads.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe(t.id);
    expect(lines[0].machine).toBe(t.machine);
  });

  test("starts a new thread as open with no resolved timestamp", async () => {
    const { addThread } = await lib();
    const t = addThread("a title", "some context");
    expect(t.status).toBe("open");
    expect(t.resolved).toBeNull();
  });
});

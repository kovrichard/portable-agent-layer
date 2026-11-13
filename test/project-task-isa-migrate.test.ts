import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readProject } from "../src/hooks/lib/projects";
import {
  projectCli,
  projectCliHome,
  projectCliJson,
  seedProject,
} from "./lib/project-cli-fixture";

const home = projectCliHome(import.meta.file);

function taskIsa(slug: string): string {
  return resolve(home(), "memory", "work", slug, "ISA.md");
}

function isoWithinTheLastMinute(text: string | undefined): void {
  expect(text).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  expect(Date.now() - Date.parse(text ?? "")).toBeLessThan(60_000);
}

describe("scaffold-task-isa", () => {
  test("writes an active task ISA named after the title", async () => {
    const out = await projectCliJson("scaffold-task-isa", "Fix", "the  Login!", "bug");
    const slug = String(out.slug);

    expect(slug).toMatch(/^fix-the-login-bug-[0-9a-z]+$/);
    expect(out).toEqual({ created: true, slug, path: taskIsa(slug) });
    const content = readFileSync(taskIsa(slug), "utf-8");
    const started = content.match(/^started: "(.+)"$/m)?.[1];
    isoWithinTheLastMinute(started);
    expect(content).toBe(
      [
        "---",
        'task: "Fix the  Login! bug"',
        `slug: "${slug}"`,
        "phase: active",
        `started: "${started}"`,
        `updated: "${started}"`,
        "---",
        "",
        "## Goal",
        "",
        "",
        "## Criteria",
        "",
        "",
      ].join("\n")
    );
  });

  test("a blank title is a usage error and writes nothing", async () => {
    const run = await projectCli("scaffold-task-isa", "  ");

    expect(run.code).toBe(1);
    expect(run.stderr).toContain("error: <title...> is empty");
    expect(existsSync(resolve(home(), "memory", "work"))).toBe(false);
  });
});

describe("complete-task-isa", () => {
  test("marks the phase complete and bumps updated, leaving the rest", async () => {
    const isa = taskIsa("t-1");
    mkdirSync(resolve(isa, ".."), { recursive: true });
    writeFileSync(
      isa,
      '---\ntask: "t"\nprior_phase: draft\nphase: active\nlast_updated: never\nupdated: "2026-01-01"\n---\n'
    );

    expect(await projectCliJson("complete-task-isa", "t-1")).toEqual({
      completed: true,
      slug: "t-1",
    });
    const content = readFileSync(isa, "utf-8");
    const updated = content.match(/^updated: "(.+)"$/m)?.[1];
    isoWithinTheLastMinute(updated);
    expect(content).toBe(
      `---\ntask: "t"\nprior_phase: draft\nphase: complete\nlast_updated: never\nupdated: "${updated}"\n---\n`
    );
  });

  test("an unknown slug exits 1", async () => {
    const run = await projectCli("complete-task-isa", "nope");

    expect(run.code).toBe(1);
    expect(run.stderr).toBe("Task ISA not found: nope\n");
  });
});

function legacyFile(name: string, content: unknown): void {
  const dir = resolve(home(), "memory", "state", "progress");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, name),
    typeof content === "string" ? content : JSON.stringify(content)
  );
}

function legacyProject(name: string) {
  return {
    name,
    path: resolve(home(), "no-such-checkout"),
    status: "active",
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-02T00:00:00Z",
    objectives: ["ship"],
  };
}

describe("migrate", () => {
  test("with no legacy files there is nothing to do", async () => {
    legacyFile("notes.txt", "not json");

    expect(await projectCliJson("migrate")).toEqual({
      migrated: 0,
      skipped: 0,
      results: [],
    });
  });

  test("migrates good files and says why each other one was skipped", async () => {
    seedProject(home(), { name: "kept" });
    legacyFile("fresh.json", legacyProject("fresh"));
    legacyFile("kept.json", legacyProject("kept"));
    legacyFile("partial.json", { name: "partial" });
    legacyFile("broken.json", "{ not json");
    legacyFile("ignored.md", "# not a progress file");

    const out = await projectCliJson("migrate");

    expect(out.migrated).toBe(1);
    expect(out.skipped).toBe(3);
    expect((out.results as string[]).toSorted()).toEqual([
      "broken: skipped (read/write error)",
      "fresh: migrated",
      "kept: skipped (ISA.md already exists)",
      "partial: skipped (malformed JSON)",
    ]);
    expect(readProject("fresh")).toMatchObject({
      name: "fresh",
      status: "active",
      goal: "- ship",
    });
    expect(readProject("partial")).toBeNull();
  });
});

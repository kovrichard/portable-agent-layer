import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildSystemReminder } from "../src/hooks/lib/context";
import { appendEvent } from "../src/hooks/lib/progress-tree";
import { writeProject } from "../src/hooks/lib/projects";
import { reload } from "../src/hooks/lib/settings";
import { freshPalHomeEachTest } from "./lib/context-build-fixture";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const { home: HOME, write } = freshPalHomeEachTest(import.meta.file);

describe("buildSystemReminder", () => {
  function withSessionIn<T>(dir: string, run: () => T): T {
    const savedStart = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = dir;
    try {
      return run();
    } finally {
      if (savedStart === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = savedStart;
    }
  }

  function projectWithWork(): string {
    const dir = resolve(HOME, "tree-project");
    mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    writeProject({
      name: "tree-project",
      path: dir,
      status: "active",
      created: now,
      updated: now,
    });
    appendEvent("tree-project", "n1", "open", { title: "Lane D wording", parent: null });
    appendEvent("tree-project", "n1", "stopped", { text: "restore WIP wording" });
    write(
      "memory/pal-settings.json",
      JSON.stringify({ dynamicContext: { progressTree: true } })
    );
    reload();
    return dir;
  }

  test("starts the session with the progress tree of the project it started in", () => {
    const dir = projectWithWork();
    const out = withSessionIn(dir, () => buildSystemReminder({ agent: "claude" }));
    expect(out).toContain("## Progress tree — tree-project");
    expect(out).toContain(
      "Active: Lane D wording [n1] — stopped at: restore WIP wording"
    );
  });

  test("shows the progress tree with no setting for it", () => {
    const dir = projectWithWork();
    write("memory/pal-settings.json", JSON.stringify({ dynamicContext: {} }));
    reload();
    expect(withSessionIn(dir, () => buildSystemReminder())).toContain("## Progress tree");
  });

  test("marks the project the session started in, not the folder it moved to", () => {
    const startDir = resolve(HOME, "started-here");
    mkdirSync(startDir, { recursive: true });
    writeProject({
      name: "started-here",
      path: startDir,
      status: "active",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    });
    const savedStart = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = startDir;
    try {
      expect(buildSystemReminder()).toContain("**started-here** (just now) → here");
    } finally {
      if (savedStart === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = savedStart;
    }
  });
});

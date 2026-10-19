import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");

let root: string;
let userHome: string;
let palHome: string;
let claudeDir: string;
let oldFactory: string;
let newFactory: string;

beforeEach(() => {
  root = realpathSync(freshTestDir(import.meta.file));
  userHome = resolve(root, "user");
  palHome = resolve(root, "pal");
  claudeDir = resolve(userHome, ".claude");
  oldFactory = resolve(palHome, "dark-factory");
  newFactory = resolve(userHome, ".dark-factory");
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(palHome, { recursive: true });
});

function migrate(...args: string[]) {
  const result = spawnSync("bun", [CLI, "cli", "migrate", ...args], {
    env: {
      ...process.env,
      HOME: userHome,
      USERPROFILE: userHome,
      PAL_HOME: palHome,
      PAL_CLAUDE_DIR: claudeDir,
      DARK_FACTORY_HOME: undefined,
    },
    encoding: "utf-8",
    timeout: 60_000,
  });
  return `${result.stdout}${result.stderr}`;
}

const hasPendingMigration = () => !migrate("--list").includes("No pending migrations.");

const settingsPath = () => resolve(claudeDir, "settings.json");
const writeClaudeSettings = (value: unknown) =>
  writeFileSync(settingsPath(), JSON.stringify(value));
const readClaudeSettings = () => JSON.parse(readFileSync(settingsPath(), "utf-8"));

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, GIT_CEILING_DIRECTORIES: undefined },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function repoWithWorktreeInOldFactory(id: string): string {
  const repo = resolve(root, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  writeFileSync(resolve(repo, "file.txt"), "content\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  mkdirSync(resolve(oldFactory, "worktrees"), { recursive: true });
  git(
    repo,
    "worktree",
    "add",
    "-q",
    "-b",
    `factory/${id}`,
    resolve(oldFactory, "worktrees", id)
  );
  return repo;
}

const registeredWorktrees = (repo: string) =>
  git(repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

function writeTask(factory: string, id: string, spec: string): void {
  mkdirSync(resolve(factory, "tasks", id), { recursive: true });
  writeFileSync(resolve(factory, "tasks", id, "spec.md"), spec);
}

describe("the DARK_FACTORY_HOME PAL used to write into Claude Code's settings", () => {
  test("is pending while it holds the value PAL wrote, and running it removes the key and an emptied env", () => {
    writeClaudeSettings({
      model: "opus",
      env: { DARK_FACTORY_HOME: resolve(palHome, "dark-factory") },
    });
    expect(hasPendingMigration()).toBe(true);

    migrate();

    expect(readClaudeSettings()).toEqual({ model: "opus" });
    expect(hasPendingMigration()).toBe(false);
  });

  test("keeps the other env entries when it removes the key", () => {
    writeClaudeSettings({
      env: { DARK_FACTORY_HOME: resolve(palHome, "dark-factory"), OTHER: "1" },
    });

    migrate();

    expect(readClaudeSettings()).toEqual({ env: { OTHER: "1" } });
  });

  test("a value the user set to something else is left alone and not pending", () => {
    const mine = { env: { DARK_FACTORY_HOME: resolve(root, "my-own-factory") } };
    writeClaudeSettings(mine);

    expect(hasPendingMigration()).toBe(false);
    migrate();

    expect(readClaudeSettings()).toEqual(mine);
  });

  test("a dry run leaves the settings as they were", () => {
    const written = { env: { DARK_FACTORY_HOME: resolve(palHome, "dark-factory") } };
    writeClaudeSettings(written);

    migrate("--dry-run");

    expect(readClaudeSettings()).toEqual(written);
  });
});

describe("the factory folder under the PAL home", () => {
  test("is pending while it exists, and tasks and events move to ~/.dark-factory", () => {
    writeTask(oldFactory, "t1", "# Spec one\n");
    writeFileSync(resolve(oldFactory, "events.jsonl"), '{"event":"a"}\n');
    expect(hasPendingMigration()).toBe(true);

    migrate();

    expect(readFileSync(resolve(newFactory, "tasks", "t1", "spec.md"), "utf-8")).toBe(
      "# Spec one\n"
    );
    expect(readFileSync(resolve(newFactory, "events.jsonl"), "utf-8")).toBe(
      '{"event":"a"}\n'
    );
    expect(existsSync(resolve(oldFactory, "tasks", "t1"))).toBe(false);
    expect(hasPendingMigration()).toBe(false);
  });

  test("a git worktree ends up at ~/.dark-factory/worktrees/<id>, still registered with git", () => {
    const repo = repoWithWorktreeInOldFactory("t1");
    writeTask(oldFactory, "t1", "# Spec\n");

    migrate();

    const moved = resolve(newFactory, "worktrees", "t1");
    expect(readFileSync(resolve(moved, "file.txt"), "utf-8")).toBe("content\n");
    expect(registeredWorktrees(repo)).toContain(moved);
    expect(registeredWorktrees(repo)).not.toContain(
      resolve(oldFactory, "worktrees", "t1")
    );
    expect(git(moved, "status", "--short")).toBe("");
  });

  test("a colliding task is not overwritten and the run reports it skipped, while the others move", () => {
    writeTask(oldFactory, "same", "# from the old home\n");
    writeTask(oldFactory, "fresh", "# fresh\n");
    writeTask(newFactory, "same", "# already in the new home\n");

    const output = migrate();

    expect(readFileSync(resolve(newFactory, "tasks", "same", "spec.md"), "utf-8")).toBe(
      "# already in the new home\n"
    );
    expect(readFileSync(resolve(oldFactory, "tasks", "same", "spec.md"), "utf-8")).toBe(
      "# from the old home\n"
    );
    expect(existsSync(resolve(newFactory, "tasks", "fresh", "spec.md"))).toBe(true);
    expect(output).toContain("same");
    expect(output).toContain("Skipped: 1");
  });

  test("events.jsonl lines are appended to an existing file, not replaced", () => {
    mkdirSync(oldFactory, { recursive: true });
    mkdirSync(newFactory, { recursive: true });
    writeFileSync(resolve(oldFactory, "events.jsonl"), '{"event":"old"}\n');
    writeFileSync(resolve(newFactory, "events.jsonl"), '{"event":"new"}\n');

    migrate();

    expect(readFileSync(resolve(newFactory, "events.jsonl"), "utf-8")).toBe(
      '{"event":"new"}\n{"event":"old"}\n'
    );
  });

  test("a dry run changes nothing", () => {
    const repo = repoWithWorktreeInOldFactory("t1");
    writeTask(oldFactory, "t1", "# Spec\n");
    writeFileSync(resolve(oldFactory, "events.jsonl"), '{"event":"a"}\n');

    migrate("--dry-run");

    expect(existsSync(newFactory)).toBe(false);
    expect(readFileSync(resolve(oldFactory, "tasks", "t1", "spec.md"), "utf-8")).toBe(
      "# Spec\n"
    );
    expect(readdirSync(resolve(oldFactory, "worktrees"))).toEqual(["t1"]);
    expect(registeredWorktrees(repo)).toContain(resolve(oldFactory, "worktrees", "t1"));
  });
});

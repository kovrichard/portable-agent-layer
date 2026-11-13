import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  driftedLocks,
  lockDirs,
  lockInputsChanged,
  lockInputsInCheckout,
} from "../.agents/scripts/check-lock";
import { outsideRepoHome } from "./lib/test-home";

function run(cwd: string, command: string, args: string[]): void {
  const r = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${command} ${args.join(" ")}: ${r.stderr}`);
}

function writeManifest(dir: string, dependencies: Record<string, string>): void {
  mkdirSync(join(dir, "helper"), { recursive: true });
  writeFileSync(join(dir, "helper", "package.json"), JSON.stringify({ name: "helper" }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", dependencies }));
}

const LOCKED = { helper: "file:./helper" };
const DRIFTED = { helper: "file:./helper", other: "file:./helper" };

let reposMade = 0;

function repoWithLockedProjects(): string {
  reposMade += 1;
  const root = join(outsideRepoHome(import.meta.path), String(reposMade));
  writeManifest(root, LOCKED);
  writeManifest(join(root, "nested"), LOCKED);
  run(root, process.execPath, ["install", "--lockfile-only"]);
  run(join(root, "nested"), process.execPath, ["install", "--lockfile-only"]);
  run(root, "git", ["init", "-q"]);
  run(root, "git", ["add", "-A"]);
  run(root, "git", [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-qm",
    "init",
  ]);

  return root;
}

describe("driftedLocks", () => {
  test("passes when every lock matches its manifest", () => {
    const root = repoWithLockedProjects();
    expect(lockDirs(lockInputsInCheckout(root))).toEqual([".", "nested"]);
    expect(driftedLocks(root)).toEqual([]);
  });

  test("names only the project whose manifest changed without its lock", () => {
    const root = repoWithLockedProjects();
    writeManifest(join(root, "nested"), DRIFTED);
    expect(driftedLocks(root)).toEqual(["nested"]);
  });

  test("flags a lock bun would delete because no dependency is left", () => {
    const root = repoWithLockedProjects();
    writeManifest(root, {});
    expect(driftedLocks(root)).toEqual(["."]);
  });

  test("leaves the checkout's lock untouched", () => {
    const root = repoWithLockedProjects();
    writeManifest(root, DRIFTED);
    driftedLocks(root);
    expect(
      spawnSync("git", ["status", "--porcelain"], { cwd: root }).stdout.toString()
    ).toBe(" M package.json\n");
  });

  test("every bun.lock in this repo matches its package.json files", () => {
    expect(driftedLocks(resolve(import.meta.dir, ".."))).toEqual([]);
  });
});

describe("lockInputsChanged", () => {
  test("ignores a change outside the lock inputs", () => {
    const root = repoWithLockedProjects();
    writeFileSync(join(root, "index.ts"), "export {};\n");
    expect(lockInputsChanged(root)).toBe(false);
  });

  test("sees an edited manifest", () => {
    const root = repoWithLockedProjects();
    writeManifest(root, DRIFTED);
    expect(lockInputsChanged(root)).toBe(true);
  });
});

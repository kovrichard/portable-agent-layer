/**
 * An item leaves test/shipped-surface.json only by moving from `current` to
 * `retired`, which makes shipped-surface.spawn.test.ts demand the migration that
 * removes it from older machines. Deleting the line instead passes every other
 * test, so this one compares the manifest with the one on the branch it merges into.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const MANIFEST = "test/shipped-surface.json";

function git(...args: string[]): string {
  const result = spawnSync("git", args, { cwd: REPO, encoding: "utf-8" });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function everyListedItem(json: string): Set<string> {
  const { current, retired } = JSON.parse(json) as {
    current: string[];
    retired: string[];
  };
  return new Set([...current, ...retired]);
}

function isShallowClone(): boolean {
  return git("rev-parse", "--is-shallow-repository").trim() === "true";
}

function pullRequestBase(baseBranch: string): string {
  if (isShallowClone()) git("fetch", "--depth=1", "origin", baseBranch);
  else git("fetch", "origin", baseBranch);
  return "FETCH_HEAD";
}

function localBase(): string {
  return git("merge-base", "HEAD", "origin/canary").trim();
}

function baseManifest(): Set<string> {
  const pullRequestBranch = process.env.GITHUB_BASE_REF;
  const base = pullRequestBranch ? pullRequestBase(pullRequestBranch) : localBase();
  return everyListedItem(git("show", `${base}:${MANIFEST}`));
}

const isCiPush = Boolean(process.env.CI) && !process.env.GITHUB_BASE_REF;

describe("the shipped-surface manifest", () => {
  test.skipIf(isCiPush)(
    "drops nothing it listed: an item that stops shipping moves to retired",
    () => {
      const now = everyListedItem(readFileSync(resolve(REPO, MANIFEST), "utf-8"));
      expect([...baseManifest()].filter((item) => !now.has(item))).toEqual([]);
    }
  );
});

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const LOCK_INPUT_NAMES = new Set(["package.json", "bun.lock", "bunfig.toml", ".npmrc"]);

export function isLockInput(path: string): boolean {
  return LOCK_INPUT_NAMES.has(basename(path));
}

function git(root: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || `git ${args.join(" ")} failed`);
  return r.stdout;
}

export function lockInputsInCheckout(root: string): string[] {
  return git(root, ["ls-files", "--cached", "--others", "--exclude-standard"])
    .split("\n")
    .filter((path) => isLockInput(path) && existsSync(join(root, path)));
}

export function pathsInPorcelain(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => line.slice(3).split(" -> "));
}

export function lockInputsChanged(root: string): boolean {
  return pathsInPorcelain(git(root, ["status", "--porcelain=v1"])).some(isLockInput);
}

export function lockDirs(inputs: string[]): string[] {
  return inputs.filter((path) => basename(path) === "bun.lock").map(dirname);
}

function copyInto(target: string, root: string, inputs: string[]): void {
  for (const path of inputs) {
    mkdirSync(join(target, dirname(path)), { recursive: true });
    copyFileSync(join(root, path), join(target, path));
  }
}

function regenerateLock(projectDir: string): void {
  const r = spawnSync(
    process.execPath,
    ["install", "--lockfile-only", "--ignore-scripts"],
    {
      cwd: projectDir,
      encoding: "utf8",
    }
  );
  if (r.status !== 0)
    throw new Error(`bun install in ${projectDir} failed:\n${r.stderr}`);
}

function lockChangedOnRegenerate(projectDir: string): boolean {
  const lockPath = join(projectDir, "bun.lock");
  const committed = readFileSync(lockPath, "utf8");
  regenerateLock(projectDir);
  return !existsSync(lockPath) || readFileSync(lockPath, "utf8") !== committed;
}

export function driftedLocks(root: string): string[] {
  const inputs = lockInputsInCheckout(root);
  const scratch = mkdtempSync(join(tmpdir(), "lock-check-"));
  try {
    copyInto(scratch, root, inputs);
    return lockDirs(inputs).filter((dir) => lockChangedOnRegenerate(join(scratch, dir)));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function report(drifted: string[]): number {
  if (drifted.length === 0) {
    process.stdout.write("Every bun.lock matches its package.json files.\n");
    return 0;
  }
  const locks = drifted.map((dir) => `  ${join(dir, "bun.lock")}`).join("\n");
  process.stderr.write(
    `bun.lock out of date with its package.json files:\n${locks}\n` +
      "Run `bun install` in that folder and commit the updated bun.lock.\n"
  );
  return 1;
}

if (import.meta.main) {
  const root = git(".", ["rev-parse", "--show-toplevel"]).trim();
  if (process.argv.includes("--changed") && !lockInputsChanged(root)) {
    process.stdout.write(
      "skipped: no package.json, bun.lock, bunfig.toml or .npmrc changed\n"
    );
    process.exit(0);
  }
  process.exit(report(driftedLocks(root)));
}

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LiveRail } from "../src/cli/ui/live";
import { createStyle } from "../src/cli/ui/style";
import type { Terminal } from "../src/cli/ui/terminal";
import { downloadCommand, runUpdate } from "../src/cli/update-flow";
import {
  checkForUpdate,
  clearUpdateCache,
  getUpdateNotice,
  type UpdateCache,
} from "../src/hooks/handlers/update-check";
import { paths } from "../src/hooks/lib/paths";
import { freshTestDir } from "./lib/test-home";

const release = (mode: UpdateCache["mode"], available = true): UpdateCache =>
  ({ available, current: "0.89.0", latest: "0.90.0", mode }) as UpdateCache;

const pipe: Terminal = { rich: false, color: "none", unicode: true, width: 80 };

function updating(update: UpdateCache, code = 0) {
  let out = "";
  const ran: string[][] = [];
  const reinstalls: Record<string, string>[] = [];
  const style = createStyle(pipe);
  const result = runUpdate(
    {
      check: async () => update,
      run: async (cmd, args) => {
        ran.push([cmd, ...args]);
        return { code, output: "remote said no" };
      },
      reinstall: (env) => {
        reinstalls.push(env);
        return 0;
      },
    },
    style,
    new LiveRail(style, (text) => {
      out += text;
    })
  );
  return { result, ran, reinstalls, output: () => out };
}

describe("pal cli update — the download", () => {
  test("re-pins the package, since a 0.x caret only allows patch bumps", () => {
    expect(downloadCommand(release("package")).slice(0, 2)).toEqual([
      "bun",
      ["add", "-g", "portable-agent-layer@0.90.0"],
    ]);
  });

  test("fast-forwards a clone, never merging or resetting", () => {
    expect(downloadCommand(release("repo")).slice(0, 2)).toEqual([
      "git",
      ["pull", "--ff-only"],
    ]);
  });

  test("auto-detects repo mode via .git — no env var required", () => {
    const updateCheckSrc = readFileSync(
      resolve(import.meta.dir, "../src/hooks/handlers/update-check.ts"),
      "utf-8"
    );
    expect(updateCheckSrc).not.toContain("PAL_UPDATE_MODE");
    expect(updateCheckSrc).toContain('existsSync(resolve(palPkg(), ".git"))');
  });
});

describe("pal cli update — the flow", () => {
  test("says so and stops when PAL is the latest", async () => {
    const run = updating(release("package", false));

    expect(await run.result).toBe(0);
    expect(run.ran).toEqual([]);
    expect(run.reinstalls).toEqual([]);
    expect(run.output()).toContain("Already up to date: PAL 0.89.0 is the latest");
  });

  test("downloads, then reinstalls in a process that knows the old version", async () => {
    const run = updating(release("package"));

    expect(await run.result).toBe(0);
    expect(run.output()).toContain("PAL 0.89.0 -> 0.90.0");
    expect(run.output()).toContain("ok   Download: portable-agent-layer 0.90.0");
    expect(run.reinstalls).toEqual([{ PAL_UPDATED_FROM: "0.89.0" }]);
  });

  test("a failed download says how to retry, shows why, and does not reinstall", async () => {
    const run = updating(release("package"), 1);

    expect(await run.result).toBe(1);
    expect(run.reinstalls).toEqual([]);
    expect(run.output()).toContain(
      "fail Download: try: bun add -g portable-agent-layer@0.90.0"
    );
    expect(run.output()).toContain("remote said no");
  });
});

// After a successful update the cached update-available.json still says
// available:true (checkForUpdate(true) wrote it moments earlier). Without
// invalidation the greeting + CLI-close nag "Update available" for the full 1h
// TTL even though the user just updated. update() must clear the cache.
describe("pal cli update — clears stale update cache", () => {
  const src = readFileSync(resolve(import.meta.dir, "../src/cli/index.ts"), "utf-8");
  const home = freshTestDir(import.meta.file);

  test("update() calls clearUpdateCache after a successful update", () => {
    expect(src).toContain("clearUpdateCache");
  });

  test("clearUpdateCache removes the cache so no stale notice remains", () => {
    process.env.PAL_HOME = home;
    const fp = resolve(paths.state(), "update-available.json");
    writeFileSync(
      fp,
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        available: true,
        current: "0.59.0",
        latest: "0.60.0",
        mode: "package",
      })
    );
    expect(getUpdateNotice()).toContain("Update available");

    clearUpdateCache();

    expect(existsSync(fp)).toBe(false);
    expect(getUpdateNotice()).toBeNull();
  });
});

// Repo mode must not treat local unpushed commits as an available update.
// Regression: `available = localHash !== remoteHash` reported an update whenever
// HEAD diverged from origin/main in ANY direction — so a repo that was AHEAD of
// origin (unpushed commits) nagged "Update available: X → X". The fix keys off
// the behind-count (commits on origin/main we lack), not raw hash inequality.
describe("pal cli update — repo mode ignores local unpushed commits", () => {
  const home = freshTestDir(import.meta.file);
  const origin = freshTestDir(import.meta.file);
  const clone = freshTestDir(import.meta.file);

  const git = (cwd: string, ...args: string[]) =>
    spawnSync("git", args, { cwd, stdio: "ignore" });

  const commit = (cwd: string, version: string, msg: string) => {
    writeFileSync(resolve(cwd, "package.json"), JSON.stringify({ version }));
    git(cwd, "add", "-A");
    git(cwd, "commit", "-m", msg);
  };

  test("a clone ahead of origin/main reports no update", () => {
    git(origin, "init", "--bare", "-b", "main");
    git(clone, "init", "-b", "main");
    git(clone, "config", "user.email", "t@t.t");
    git(clone, "config", "user.name", "t");
    git(clone, "remote", "add", "origin", origin);
    commit(clone, "0.61.3", "base");
    git(clone, "push", "-u", "origin", "main");

    // Diverge locally: unpushed commit, version unchanged — the exact bug shape.
    // Touch a distinct file so the commit is real (identical package.json alone
    // would be a no-op commit and create no divergence).
    writeFileSync(resolve(clone, "work.txt"), "unpushed local change");
    commit(clone, "0.61.3", "local unpushed work");

    process.env.PAL_HOME = home;
    process.env.PAL_PKG = clone;
    clearUpdateCache();

    return checkForUpdate(true).then((result) => {
      expect(result.mode).toBe("repo");
      expect(result.available).toBe(false);
    });
  });
});

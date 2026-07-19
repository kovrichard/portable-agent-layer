import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  checkForUpdate,
  clearUpdateCache,
  getUpdateNotice,
} from "../src/hooks/handlers/update-check";
import { paths } from "../src/hooks/lib/paths";

// Locks in the fix for the package-mode update bug.
// `bun update -g <pkg>` respects the caret range stored at install time, and on
// 0.x versions a caret allows only patch bumps (^0.24.2 = >=0.24.2 <0.25.0). A
// user pinned at 0.24.2 could never reach 0.29.0 via `bun update`. The fix is
// to re-pin via `bun add -g <pkg>@<latest>`.
describe("pal cli update — package mode command shape", () => {
  const src = readFileSync(resolve(import.meta.dir, "../src/cli/index.ts"), "utf-8");
  const updateCheckSrc = readFileSync(
    resolve(import.meta.dir, "../src/hooks/handlers/update-check.ts"),
    "utf-8"
  );

  test("re-pins via 'bun add -g portable-agent-layer@<latest>'", () => {
    expect(src).toMatch(
      /spawnSync\(\s*"bun"\s*,\s*\[\s*"add"\s*,\s*"-g"\s*,\s*`portable-agent-layer@\$\{result\.latest\}`/
    );
  });

  test("does not use 'bun update -g portable-agent-layer' (caret-capped)", () => {
    expect(src).not.toMatch(
      /spawnSync\(\s*"bun"\s*,\s*\[\s*"update"\s*,\s*"-g"\s*,\s*"portable-agent-layer"/
    );
  });

  test("auto-detects repo mode via .git — no env var required", () => {
    expect(updateCheckSrc).not.toContain("PAL_UPDATE_MODE");
    expect(updateCheckSrc).toContain('existsSync(resolve(palPkg(), ".git"))');
  });
});

// Repo mode is the other half of update(): a clone next to package.json is
// updated via `git pull --ff-only`. Locking this prevents accidental swaps to
// `git pull` (allows merges) or `git fetch` + reset (loses local commits).
describe("pal cli update — repo mode command shape", () => {
  const src = readFileSync(resolve(import.meta.dir, "../src/cli/index.ts"), "utf-8");

  test("uses 'git pull --ff-only'", () => {
    expect(src).toMatch(/spawnSync\(\s*"git"\s*,\s*\[\s*"pull"\s*,\s*"--ff-only"\s*\]/);
  });
});

// After a successful update the cached update-available.json still says
// available:true (checkForUpdate(true) wrote it moments earlier). Without
// invalidation the greeting + CLI-close nag "Update available" for the full 1h
// TTL even though the user just updated. update() must clear the cache.
describe("pal cli update — clears stale update cache", () => {
  const src = readFileSync(resolve(import.meta.dir, "../src/cli/index.ts"), "utf-8");
  const prevHome = process.env.PAL_HOME;
  const home = mkdtempSync(resolve(tmpdir(), "pal-update-cache-"));

  afterAll(() => {
    if (prevHome === undefined) delete process.env.PAL_HOME;
    else process.env.PAL_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

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
  const prevHome = process.env.PAL_HOME;
  const prevPkg = process.env.PAL_PKG;
  const home = mkdtempSync(resolve(tmpdir(), "pal-update-home-"));
  const origin = mkdtempSync(resolve(tmpdir(), "pal-update-origin-"));
  const clone = mkdtempSync(resolve(tmpdir(), "pal-update-clone-"));

  const git = (cwd: string, ...args: string[]) =>
    spawnSync("git", args, { cwd, stdio: "ignore" });

  const commit = (cwd: string, version: string, msg: string) => {
    writeFileSync(resolve(cwd, "package.json"), JSON.stringify({ version }));
    git(cwd, "add", "-A");
    git(cwd, "commit", "-m", msg);
  };

  afterAll(() => {
    if (prevHome === undefined) delete process.env.PAL_HOME;
    else process.env.PAL_HOME = prevHome;
    if (prevPkg === undefined) delete process.env.PAL_PKG;
    else process.env.PAL_PKG = prevPkg;
    for (const dir of [home, origin, clone])
      rmSync(dir, { recursive: true, force: true });
  });

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

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { clearUpdateCache, getUpdateNotice } from "../src/hooks/handlers/update-check";
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

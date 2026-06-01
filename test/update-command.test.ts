import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

  test("defaults status/update checks to package mode", () => {
    expect(updateCheckSrc).toContain('process.env.PAL_UPDATE_MODE === "repo"');
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

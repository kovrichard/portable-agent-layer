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
});

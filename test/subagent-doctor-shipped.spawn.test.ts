import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assets } from "../src/hooks/lib/paths";
import { removeOnceReleased } from "./lib/remove-once-released";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { testHome } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const HOME = testHome(import.meta.file);

describe("pal cli subagent doctor <shipped path>", () => {
  test("exits 0 and says the file is a shipped PAL subagent", () => {
    const r = spawnSync(
      "bun",
      ["run", CLI, "cli", "subagent", "doctor", resolve(assets.agents(), "scout.md")],
      {
        env: { ...process.env, PAL_HOME: resolve(HOME, ".pal") },
        encoding: "utf-8",
        timeout: 30000,
      }
    );
    removeOnceReleased(HOME);
    expect(r.stdout).toContain("is a shipped PAL subagent");
    expect(r.status).toBe(0);
  });
});

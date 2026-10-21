import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

describe("self-model entrypoint", () => {
  test("accepts the --agent flag every detached inference spawn appends", () => {
    const run = Bun.spawnSync(
      [
        "bun",
        join(import.meta.dir, "..", "src", "tools", "self-model.ts"),
        "--help",
        "--agent=codex",
      ],
      { stdout: "pipe", stderr: "pipe", env: process.env }
    );
    expect(run.stderr.toString()).not.toContain("Unknown option");
    expect(run.exitCode).toBe(0);
  });
});

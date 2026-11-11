import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const REPO = resolve(import.meta.dir, "..");

type Violation = { file: string; line: number; rule: string; severity: string };

describe("500-line warning", () => {
  test("klint.yaml holds the 500-line warning beside the hook-entrypoint ceiling", () => {
    const config = Bun.YAML.parse(readFileSync(resolve(REPO, "klint.yaml"), "utf-8")) as {
      arch: { maxLines: unknown[] };
    };
    expect(config.arch.maxLines).toContainEqual({
      limit: 500,
      in: ["src/**"],
      message: "File is over 500 lines — split it into modules with one purpose each.",
      severity: "warn",
    });
    expect(config.arch.maxLines).toContainEqual({
      limit: 90,
      in: ["src/hooks/*.ts", "!src/hooks/handlers/**", "!src/hooks/lib/**"],
      message:
        "Hook entrypoint is too long to be only glue — move the logic to src/hooks/lib/ where a test can import it.",
    });
  });

  test("klint warns, never fails, on src files over 500 lines", () => {
    const run = spawnSync("bun", ["x", "klint", "--json"], {
      cwd: REPO,
      encoding: "utf-8",
      env: { ...process.env, KLINT_NO_STATS: "1" },
    });
    expect(run.status).toBe(0);
    const report = JSON.parse(run.stdout) as {
      violations: Violation[];
      summary: { errors: number };
    };
    expect(report.summary.errors).toBe(0);
    const overLimit = report.violations
      .filter((v) => v.rule === "arch/max-lines" && v.line === 501)
      .map((v) => ({ ...v, file: v.file.replaceAll("\\", "/") }));
    expect(overLimit.map((v) => v.severity)).toEqual(overLimit.map(() => "warn"));
    expect(overLimit.filter((v) => v.file.startsWith("src/targets/"))).toEqual([]);
    expect(overLimit.map((v) => v.file)).toContain("src/hooks/lib/inference.ts");
  });
});

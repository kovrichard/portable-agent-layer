import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../cli.ts");

function run(dir: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("bun", [CLI, "--config", dir], {
    encoding: "utf-8",
    timeout: 15000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? -1,
  };
}

describe("YAML config loading", () => {
  test("reads klint.yaml when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "klint-yaml-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "subject.ts"), `const x = 1;\n`);
    writeFileSync(
      join(dir, "klint.yaml"),
      `include: ["src"]\nrules:\n  no-floating-promise: error\n`
    );
    try {
      const { stdout, code } = run(dir);
      expect(code).toBe(0);
      expect(stdout).toContain("0 violations");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("falls back to klint.config.json when no YAML present", () => {
    const dir = mkdtempSync(join(tmpdir(), "klint-json-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "subject.ts"), `const x = 1;\n`);
    writeFileSync(
      join(dir, "klint.config.json"),
      JSON.stringify({ include: ["src"], rules: { "no-floating-promise": "error" } })
    );
    try {
      const { stdout, code } = run(dir);
      expect(code).toBe(0);
      expect(stdout).toContain("0 violations");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("prefers klint.yaml over klint.config.json when both exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "klint-both-"));
    mkdirSync(join(dir, "src"));
    // YAML: no-floating-promise on (produces no violation on clean code)
    // JSON: intentionally malformed — if it were read, parsing would fail
    writeFileSync(
      join(dir, "klint.yaml"),
      `include: ["src"]\nrules:\n  no-floating-promise: error\n`
    );
    writeFileSync(join(dir, "klint.config.json"), "THIS IS NOT JSON");
    writeFileSync(join(dir, "src", "subject.ts"), `const x = 1;\n`);
    try {
      const { stdout, code } = run(dir);
      expect(code).toBe(0);
      expect(stdout).toContain("0 violations");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("emits error message when neither config file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "klint-noconfig-"));
    try {
      const { stderr, code } = run(dir);
      expect(code).toBe(1);
      expect(stderr).toContain("no config file found");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const ROOT = resolve(import.meta.dir, "../.test-home-doctor-cursor");
const BUN_DIR = dirname(process.execPath);

function binDirWith(name: string, binaries: string[]): string {
  const dir = resolve(ROOT, name);
  mkdirSync(dir, { recursive: true });
  for (const binary of binaries) {
    const path = resolve(dir, binary);
    writeFileSync(path, `#!/bin/sh\necho "${binary} 2026.10.01"\n`);
    chmodSync(path, 0o755);
  }
  return dir;
}

function doctorWithPath(binDir: string) {
  return spawnSync("bun", ["run", CLI, "cli", "doctor"], {
    cwd: REPO,
    env: {
      ...process.env,
      PATH: `${binDir}:${BUN_DIR}`,
      PAL_HOME: resolve(ROOT, ".pal"),
    },
    encoding: "utf-8",
    timeout: 30000,
  });
}

beforeAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
});

afterAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
});

describe("pal cli doctor — Cursor detection", () => {
  test("finds the Cursor CLI, which installs cursor-agent and no cursor command", () => {
    const r = doctorWithPath(binDirWith("cli-only", ["cursor-agent", "agent"]));

    expect(r.stdout).not.toContain("Cursor — not found");
    expect(r.stdout).toContain("Cursor cursor-agent 2026.10.01");
  });

  test("still finds the Cursor editor when only its cursor command is on PATH", () => {
    const r = doctorWithPath(binDirWith("editor-only", ["cursor"]));

    expect(r.stdout).not.toContain("Cursor — not found");
    expect(r.stdout).toContain("Cursor cursor 2026.10.01");
  });

  test("reports Cursor missing when neither is on PATH", () => {
    const r = doctorWithPath(binDirWith("neither", []));

    expect(r.stdout).toContain("Cursor — not found");
  });
});

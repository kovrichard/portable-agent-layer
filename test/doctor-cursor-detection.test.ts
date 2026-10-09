import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const REPO = resolve(import.meta.dir, "..");
const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const ROOT = testHome(import.meta.file);
const BUN_DIR = dirname(process.execPath);
const WINDOWS = process.platform === "win32";

function writeFakeBinary(dir: string, binary: string): void {
  if (WINDOWS) {
    writeFileSync(
      resolve(dir, `${binary}.cmd`),
      `@echo off\r\necho ${binary} 2026.10.01\r\n`
    );
    return;
  }
  const path = resolve(dir, binary);
  writeFileSync(path, `#!/bin/sh\necho "${binary} 2026.10.01"\n`);
  chmodSync(path, 0o755);
}

function binDirWith(name: string, binaries: string[]): string {
  const dir = resolve(ROOT, name);
  mkdirSync(dir, { recursive: true });
  for (const binary of binaries) writeFakeBinary(dir, binary);
  return dir;
}

function envWithoutPath(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH")
  );
}

function doctorWithPath(binDir: string) {
  return spawnSync(process.execPath, ["run", CLI, "cli", "doctor", "--json"], {
    cwd: REPO,
    env: {
      ...envWithoutPath(),
      PATH: `${binDir}${delimiter}${BUN_DIR}`,
      PAL_HOME: resolve(ROOT, ".pal"),
      PAL_SKIP_DOCTOR: "0",
    },
    encoding: "utf-8",
    timeout: 30000,
  });
}

function agentsFound(stdout: string): string[] {
  return (JSON.parse(stdout) as { agents: string[] }).agents;
}

beforeAll(() => {
  removeOnceReleased(ROOT);
});

afterAll(() => {
  removeOnceReleased(ROOT);
});

describe("pal cli doctor — Cursor detection", () => {
  test("finds the Cursor CLI, which installs cursor-agent and no cursor command", () => {
    const r = doctorWithPath(binDirWith("cli-only", ["cursor-agent", "agent"]));

    expect(agentsFound(r.stdout)).toContain("cursor");
  });

  test("still finds the Cursor editor when only its cursor command is on PATH", () => {
    const r = doctorWithPath(binDirWith("editor-only", ["cursor"]));

    expect(agentsFound(r.stdout)).toContain("cursor");
  });

  test("reports Cursor missing when neither is on PATH", () => {
    const r = doctorWithPath(binDirWith("neither", []));

    expect(agentsFound(r.stdout)).not.toContain("cursor");
  });
});

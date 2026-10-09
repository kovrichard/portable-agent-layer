/**
 * test/shipped-surface.json lists everything a fresh install writes. When an
 * item stops shipping, it moves to `retired`, and an install must remove it
 * from a machine an older PAL left it on — so retiring anything needs the
 * migration that cleans it up. Refresh the list with:
 *
 *   PAL_SURFACE_UPDATE=1 bun test test/shipped-surface.test.ts
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { linkFile } from "./lib/links";
import { plant, ROOTS, surface } from "./lib/shipped-surface";
import { freshTestDir } from "./lib/test-home";

interface Manifest {
  current: string[];
  retired: string[];
}

const PKG = resolve(import.meta.dir, "..");
const CLI = resolve(PKG, "src", "cli", "index.ts");
const MANIFEST = resolve(import.meta.dir, "shipped-surface.json");
const AGENTS = ["claude", "opencode", "cursor-agent", "copilot", "codex"];

function fakeAgentsOnPath(root: string): void {
  const bin = resolve(root, "bin");
  mkdirSync(bin, { recursive: true });
  for (const agent of AGENTS) {
    writeFileSync(resolve(bin, agent), "#!/bin/sh\necho 1.0.0\n");
    chmodSync(resolve(bin, agent), 0o755);
  }
  linkFile(process.execPath, resolve(bin, "bun"));
}

function install(root: string): void {
  const { PAL_PKG: _pkg, PAL_TEST_SANDBOX: _sandbox, ...inherited } = process.env;
  const dirs = Object.fromEntries(
    ROOTS.filter((dir) => dir !== "home").map((dir) => [
      `PAL_${dir.slice(1).toUpperCase()}_DIR`,
      resolve(root, dir),
    ])
  );
  const result = spawnSync("bun", [CLI, "cli", "install"], {
    env: {
      ...inherited,
      ...dirs,
      HOME: resolve(root, "user"),
      PATH: [resolve(root, "bin"), "/usr/bin", "/bin"].join(":"),
      PAL_HOME: resolve(root, "home"),
      PAL_SKIP_BROWSER_INSTALL: "1",
      PAL_SKIP_DOCTOR: "1",
    },
    encoding: "utf-8",
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error(`install failed: ${result.stderr}`);
}

function sandbox(): string {
  const root = realpathSync(freshTestDir(import.meta.file));
  mkdirSync(resolve(root, "user"));
  fakeAgentsOnPath(root);
  install(root);
  return root;
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST, "utf-8"));
}

function refreshed(previous: Manifest, current: string[]): Manifest {
  const dropped = previous.current.filter((item) => !current.includes(item));
  const retired = [...new Set([...previous.retired, ...dropped])]
    .filter((item) => !current.includes(item))
    .sort();
  return { current, retired };
}

let fresh: string[];
let planted: string[];
let reinstalled: string[];

describe.skipIf(process.platform === "win32")("what PAL ships", () => {
  beforeAll(() => {
    const clean = sandbox();
    fresh = surface(clean, PKG);
    if (process.env.PAL_SURFACE_UPDATE === "1")
      writeFileSync(
        MANIFEST,
        `${JSON.stringify(refreshed(readManifest(), fresh), null, 2)}\n`
      );

    const old = sandbox();
    for (const item of readManifest().retired) plant(old, PKG, item);
    planted = surface(old, PKG);
    install(old);
    reinstalled = surface(old, PKG);
  }, 300_000);

  test("a fresh install writes exactly what the manifest lists", () => {
    expect(fresh).toEqual(readManifest().current);
  });

  test("every retired item can be recreated the way an older PAL left it", () => {
    expect(readManifest().retired.filter((item) => !planted.includes(item))).toEqual([]);
  });

  test("an install removes every retired item", () => {
    expect(readManifest().retired.filter((item) => reinstalled.includes(item))).toEqual(
      []
    );
  });

  test("an install leaves an older machine exactly like a fresh one", () => {
    expect(reinstalled).toEqual(fresh);
  });
});

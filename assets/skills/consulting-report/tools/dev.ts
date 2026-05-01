#!/usr/bin/env bun

// consulting-report skill tool: launch the Next.js dev server for live preview.
//
// Usage:
//   bun ~/.pal/skills/consulting-report/tools/dev.ts <report-dir>

import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function dev(reportDir: string): Promise<number> {
  const dir = resolve(reportDir);
  const pkg = join(dir, "package.json");
  if (!(await exists(pkg))) {
    throw new Error(`not a scaffolded report (missing package.json): ${dir}`);
  }
  const result = spawnSync("bun", ["run", "dev"], {
    cwd: dir,
    stdio: "inherit",
    shell: true,
  });
  return result.status ?? 1;
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.length === 0) {
    console.error("usage: dev.ts <report-dir>");
    process.exit(1);
  }
  const status = await dev(argv[0]);
  process.exit(status);
}

if (import.meta.main) {
  await run();
}

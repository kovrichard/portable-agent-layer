#!/usr/bin/env bun

// consulting-report skill tool: scaffold a new report directory from the template
// and install Next.js dependencies.
//
// Usage:
//   bun ~/.pal/skills/consulting-report/tools/scaffold.ts <target-dir> \
//        [--client "Client Name"] [--title "Report Title"] [--no-install]

import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface ScaffoldOptions {
  targetDir: string;
  clientName?: string;
  reportTitle?: string;
  install?: boolean;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function templateDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "template");
}

export async function scaffold(opts: ScaffoldOptions): Promise<void> {
  const tpl = templateDir();
  if (!(await exists(tpl))) {
    throw new Error(`template not found at ${tpl}`);
  }
  if (await exists(opts.targetDir)) {
    throw new Error(`target already exists: ${opts.targetDir}`);
  }

  await mkdir(dirname(opts.targetDir), { recursive: true });
  await cp(tpl, opts.targetDir, { recursive: true });

  if (opts.clientName || opts.reportTitle) {
    const dataPath = join(opts.targetDir, "lib", "report-data.ts");
    let data = await readFile(dataPath, "utf8");
    if (opts.clientName) {
      data = data.replace(/\[CLIENT NAME\]/g, opts.clientName);
    }
    if (opts.reportTitle) {
      data = data.replace(
        /Strategic Assessment & Transformation Roadmap/,
        opts.reportTitle
      );
    }
    await writeFile(dataPath, data, "utf8");
  }

  if (opts.install !== false) {
    console.log("Installing dependencies (bun install)...");
    const result = spawnSync("bun", ["install"], {
      cwd: opts.targetDir,
      stdio: "inherit",
      shell: true,
    });
    if (result.status !== 0) {
      console.warn(
        `bun install failed (exit ${result.status}) — run it manually in ${opts.targetDir}`
      );
    }
  }
}

function parseArgs(argv: string[]): ScaffoldOptions {
  if (argv.length === 0) {
    throw new Error(
      'usage: scaffold.ts <target-dir> [--client "Name"] [--title "Title"] [--no-install]'
    );
  }
  const opts: ScaffoldOptions = { targetDir: resolve(argv[0]) };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--client") opts.clientName = argv[++i];
    else if (argv[i] === "--title") opts.reportTitle = argv[++i];
    else if (argv[i] === "--no-install") opts.install = false;
  }
  return opts;
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  const opts = parseArgs(argv);
  await scaffold(opts);
  console.log(`Scaffolded: ${opts.targetDir}`);
  console.log("Next steps:");
  console.log(`  1. cd ${opts.targetDir}`);
  console.log(`  2. Edit lib/report-data.ts (metadata) and app/page.tsx (layout)`);
  console.log(`  3. Live preview:    bun run dev`);
  console.log(
    `  4. Generate PDF:    node --experimental-strip-types ~/.pal/skills/consulting-report/tools/generate-pdf.ts ${opts.targetDir}`
  );
}

if (import.meta.main) {
  await run();
}

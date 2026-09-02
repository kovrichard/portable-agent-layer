#!/usr/bin/env bun
// Transpile skill tools that must run under Node into plain-JS `.mjs` siblings.
//
// Why this exists: a few skill tools (the PDF generators) run under Node, not Bun. When PAL is installed as a
// bun global, each skill's realpath lands under node_modules, and Node 24 refuses to
// type-strip a `.ts` under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING).
// So we ship a compiled `.mjs` beside the `.ts` and invoke that instead — plain JS needs
// no stripping and runs from node_modules on every OS, preserving the Windows fallback.
//
// Reusable by design: a tool opts in by carrying the marker `pal-build:mjs` anywhere in
// its source. This script discovers every marked entry under assets/skills/*/tools/,
// transpiles it AND the local (relative) .ts files it imports, and rewrites those local
// imports to `.mjs`. External deps (playwright/marked/pdf-lib/node:*) stay as runtime
// imports. Adding a future Node-run tool = drop the marker comment in it; nothing here
// changes. Emitted `.mjs` are gitignored and regenerated at `prepack` (see package.json).

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SKILLS_DIR = resolve(import.meta.dir, "..", "assets", "skills");
const MARKER = "pal-build:mjs";
const LOCAL_TS_IMPORT = /((?:from|import)\s*\(?\s*["'])(\.\.?\/[^"']+?)\.ts(["'])/g;

const transpiler = new Bun.Transpiler({ loader: "ts", target: "node" });

function localTsDeps(source: string, fromDir: string): string[] {
  const deps: string[] = [];
  for (const [, , spec] of source.matchAll(LOCAL_TS_IMPORT)) {
    deps.push(resolve(fromDir, `${spec}.ts`));
  }
  return deps;
}

const emitted = new Set<string>();

function transpileEntry(tsPath: string): void {
  if (emitted.has(tsPath)) return;
  emitted.add(tsPath);

  const raw = readFileSync(tsPath, "utf8");
  const withoutShebang = raw.replace(/^#!.*\n/, "");
  const js = transpiler.transformSync(withoutShebang).replace(LOCAL_TS_IMPORT, "$1$2.mjs$3");

  const mjsPath = tsPath.replace(/\.ts$/, ".mjs");
  writeFileSync(mjsPath, js);
  console.log(`  ${relative(SKILLS_DIR, tsPath)} → ${relative(SKILLS_DIR, mjsPath)}`);

  for (const dep of localTsDeps(raw, dirname(tsPath))) transpileEntry(dep);
}

function toolFiles(): string[] {
  const files: string[] = [];
  for (const skill of readdirSync(SKILLS_DIR)) {
    const toolsDir = join(SKILLS_DIR, skill, "tools");
    let entries: string[];
    try {
      entries = readdirSync(toolsDir);
    } catch {
      continue; // skill has no tools/ dir
    }
    for (const f of entries) {
      if (f.endsWith(".ts") && !f.endsWith(".test.ts")) files.push(join(toolsDir, f));
    }
  }
  return files;
}

let markedEntries = 0;
for (const tsPath of toolFiles()) {
  if (readFileSync(tsPath, "utf8").includes(MARKER)) {
    markedEntries++;
    transpileEntry(tsPath);
  }
}

console.log(
  `build-skill-tools: ${emitted.size} file(s) emitted from ${markedEntries} marked entr${
    markedEntries === 1 ? "y" : "ies"
  }.`,
);

/**
 * PAI Export — Zips all gitignored personal files (memory, telos, state)
 * into a portable archive for transfer between machines.
 *
 * Usage: bun run tool:export [output-path] [--dry-run]
 * Default output: pai-export-YYYYMMDD-HHmmss.zip in the repo root.
 */

import { resolve } from "node:path";
import { collectExportFiles, exportZip, timestamp } from "../hooks/lib/export";
import { paiDir } from "../hooks/lib/paths";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const pathArg = args.find((a) => a !== "--dry-run");

const outputPath = pathArg || resolve(paiDir(), `pai-export-${timestamp()}.zip`);

if (dryRun) {
  const files = collectExportFiles();
  if (files.length === 0) {
    console.log("Nothing to export — no gitignored personal files found.");
  } else {
    console.log(`Would export ${files.length} files → ${outputPath}\n`);
    for (const f of files) console.log(`  ${f}`);
  }
} else {
  const count = exportZip(outputPath);
  if (count === 0) {
    console.log("Nothing to export — no gitignored personal files found.");
  } else {
    console.log(`Exported ${count} files → ${outputPath}`);
  }
}

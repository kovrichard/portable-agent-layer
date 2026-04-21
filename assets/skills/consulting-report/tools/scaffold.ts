#!/usr/bin/env bun

// consulting-report skill tool: scaffold a new report directory from the template.
//
// Usage:
//   bun ~/.pal/skills/consulting-report/tools/scaffold.ts <target-dir> [--client "Client Name"] [--title "Report Title"]

import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    'usage: scaffold.ts <target-dir> [--client "Client Name"] [--title "Report Title"]'
  );
  process.exit(1);
}

const targetDir = resolve(args[0]);
let clientName = "";
let reportTitle = "";
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--client") clientName = args[++i];
  else if (args[i] === "--title") reportTitle = args[++i];
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = resolve(here, "..", "template");

if (!(await exists(templateDir))) {
  console.error(`template not found at ${templateDir}`);
  process.exit(1);
}
if (await exists(targetDir)) {
  console.error(`target already exists: ${targetDir}`);
  process.exit(1);
}

await mkdir(dirname(targetDir), { recursive: true });
await cp(templateDir, targetDir, { recursive: true });

// Stamp today's date + client/title + tool import path into the new report-data.ts.
// Scaffolded reports live outside the skill tree, so the type-import needs an
// absolute path to the generator rather than a relative one.
const dataPath = join(targetDir, "content", "report-data.ts");
const toolPath = resolve(here, "generate-pdf").replace(/\.ts$/, "");
const today = new Date().toISOString().slice(0, 10);
let data = await readFile(dataPath, "utf8");
data = data.replace(/\{\{DATE\}\}/g, today);
data = data.replace(/\{\{TOOL_PATH\}\}/g, toolPath);
if (clientName) data = data.replace(/\{\{CLIENT_NAME\}\}/g, clientName);
if (reportTitle) data = data.replace(/\{\{REPORT_TITLE\}\}/g, reportTitle);
await writeFile(dataPath, data, "utf8");

console.log(`Scaffolded: ${targetDir}`);
console.log("Next steps:");
console.log(`  1. Edit ${join(targetDir, "content", "report-data.ts")}`);
console.log(`  2. Fill ${join(targetDir, "content")} with your section markdown files`);
console.log(`  3. Drop images into ${join(targetDir, "diagrams")}`);
console.log(`  4. Render:`);
console.log(
  `       bun ~/.pal/skills/consulting-report/tools/generate-pdf.ts ${targetDir}`
);

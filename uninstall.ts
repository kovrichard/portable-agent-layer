/**
 * PAI — main uninstaller entry point (TypeScript)
 * Usage: bun run uninstall.ts [--claude] [--opencode] [--all]
 */

import { dirname, resolve } from "node:path";
import { log } from "./targets/lib";

const PAI_DIR = resolve(dirname(import.meta.path));

const args = process.argv.slice(2);
let removeClaude = false;
let removeOpencode = false;

if (args.length === 0) {
  removeClaude = true;
  removeOpencode = true;
}

for (const arg of args) {
  if (arg === "--claude") removeClaude = true;
  else if (arg === "--opencode") removeOpencode = true;
  else if (arg === "--all") {
    removeClaude = true;
    removeOpencode = true;
  } else if (arg === "--help" || arg === "-h") {
    console.log("Usage: bun run uninstall.ts [--claude] [--opencode] [--all]");
    process.exit(0);
  } else {
    log.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
}

if (removeClaude) {
  console.log("━━━ Claude Code ━━━");
  await import("./targets/claude/uninstall");
  console.log("");
}

if (removeOpencode) {
  console.log("━━━ opencode ━━━");
  await import("./targets/opencode/uninstall");
  console.log("");
}

log.success(`PAI uninstalled. Your TELOS, skills, and memory are still in ${PAI_DIR}.`);

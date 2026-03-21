/**
 * PAI — main installer entry point (TypeScript)
 * Usage: bun run install.ts [--claude] [--opencode] [--all]
 * Default: installs for both targets.
 */

import { dirname, resolve } from "node:path";
import { ensureSetupState, isSetupComplete } from "./src/hooks/lib/setup";
import { log, scaffoldTelos } from "./src/targets/lib";

const PAI_DIR = resolve(dirname(import.meta.path));

// --- Parse args ---
const args = process.argv.slice(2);
let installClaude = false;
let installOpencode = false;

if (args.length === 0) {
  installClaude = true;
  installOpencode = true;
}

for (const arg of args) {
  if (arg === "--claude") installClaude = true;
  else if (arg === "--opencode") installOpencode = true;
  else if (arg === "--all") {
    installClaude = true;
    installOpencode = true;
  } else if (arg === "--help" || arg === "-h") {
    console.log("Usage: bun run install.ts [--claude] [--opencode] [--all]");
    console.log("");
    console.log("  --claude    Install hooks/skills for Claude Code");
    console.log("  --opencode  Install context/skills for opencode");
    console.log("  --all       Install for both (default)");
    process.exit(0);
  } else {
    log.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
}

// --- Check bun ---
if (installClaude) {
  try {
    Bun.version; // always available in bun
  } catch {
    log.error("bun is required: curl -fsSL https://bun.sh/install | bash");
    process.exit(1);
  }
}

console.log("");
console.log("  ╔═══════════════════════════════════╗");
console.log("  ║  PAI — Personal AI Infra          ║");
console.log("  ║  Non-destructive · Modular        ║");
console.log("  ╚═══════════════════════════════════╝");
console.log("");

// --- Scaffold TELOS + seed setup state ---
scaffoldTelos();
ensureSetupState();

// --- Run target installers ---
if (installClaude) {
  console.log("━━━ Claude Code ━━━");
  await import("./src/targets/claude/install");
  console.log("");
}

if (installOpencode) {
  console.log("━━━ opencode ━━━");
  await import("./src/targets/opencode/install");
  console.log("");
}

log.success("Done. Existing config was preserved — only new entries were added.");
console.log("");
log.info("Next steps:");

const state = ensureSetupState();
if (!isSetupComplete(state)) {
  log.info("  1. Start a session — PAI will guide you through first-run setup");
  log.info("  2. Or fill in telos/*.md manually, then re-run install.ts");
} else {
  log.info("  1. Fill in telos/*.md with your info (if not already done)");
  log.info("  2. Re-run install.ts to regenerate context files");
}
log.info("  3. Add skills by dropping .md files into skills/");
log.info("  4. Uninstall: bun run uninstall.ts [--claude] [--opencode]");

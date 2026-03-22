#!/usr/bin/env bun
/**
 * PAL CLI — Portable Agent Layer
 *
 * Usage: pal <command> [options]
 *
 * Commands:
 *   init                 Scaffold PAL home, install hooks for all targets
 *   install              Register hooks/skills for targets
 *   uninstall            Remove hooks/skills for targets
 *   export               Export user state (telos, memory) to a zip
 *   import               Import user state from a zip
 *   status               Show current PAL configuration
 */

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { palHome, palPkg, platform } from "../hooks/lib/paths";
import { log } from "../targets/lib";

const [command, ...args] = process.argv.slice(2);

function banner() {
  console.log("");
  console.log("  ╔═══════════════════════════════════╗");
  console.log("  ║  PAL — Portable Agent Layer       ║");
  console.log("  ║  Non-destructive · Modular        ║");
  console.log("  ╚═══════════════════════════════════╝");
  console.log("");
}

function showHelp() {
  console.log(`
  Usage: pal <command> [options]

  Commands:
    init [--claude] [--opencode] [--all]    Scaffold and install (default: all)
    install [--claude] [--opencode] [--all]  Register hooks for targets
    uninstall [--claude] [--opencode] [--all] Remove hooks for targets
    export [path] [--dry-run]               Export state to zip
    import [path] [--dry-run]               Import state from zip
    status                                  Show PAL configuration
  Environment:
    PAL_HOME              Override user state directory (default: ~/.pal or repo root)
    PAL_PKG               Override package root
    PAL_CLAUDE_DIR        Override Claude config dir (default: ~/.claude)
    PAL_OPENCODE_DIR      Override opencode config dir (default: ~/.config/opencode)
    PAL_AGENTS_DIR        Override agents dir (default: ~/.agents)
`);
}

function parseTargets(args: string[]): {
  claude: boolean;
  opencode: boolean;
} {
  if (args.length === 0) return { claude: true, opencode: true };

  let claude = false;
  let opencode = false;
  for (const arg of args) {
    if (arg === "--claude") claude = true;
    else if (arg === "--opencode") opencode = true;
    else if (arg === "--all") {
      claude = true;
      opencode = true;
    }
  }
  // If no target flags, default to all
  if (!claude && !opencode) return { claude: true, opencode: true };
  return { claude, opencode };
}

// ── Commands ──

async function init() {
  const { ensureSetupState, isSetupComplete } = await import("../hooks/lib/setup");
  const { scaffoldTelos } = await import("../targets/lib");

  banner();

  const home = palHome();
  const isRepo = existsSync(resolve(palPkg(), ".palroot"));

  if (!isRepo) {
    // Package mode — scaffold ~/.pal/
    log.info(`Creating PAL home at ${home}`);
    mkdirSync(resolve(home, "telos"), { recursive: true });
    mkdirSync(resolve(home, "memory"), { recursive: true });
  }

  scaffoldTelos();
  ensureSetupState();

  const targets = parseTargets(args);
  await install(targets);

  console.log("");
  const state = ensureSetupState();
  if (!isSetupComplete(state)) {
    log.info("Start a session — PAL will guide you through first-run setup");
  }
}

async function install(targets?: { claude: boolean; opencode: boolean }) {
  const t = targets || parseTargets(args);

  if (t.claude) {
    console.log("━━━ Claude Code ━━━");
    await import("../targets/claude/install");
    console.log("");
  }

  if (t.opencode) {
    console.log("━━━ opencode ━━━");
    await import("../targets/opencode/install");
    console.log("");
  }

  log.success("Done. Existing config was preserved — only new entries were added.");
}

async function uninstall() {
  const targets = parseTargets(args);

  if (targets.claude) {
    console.log("━━━ Claude Code ━━━");
    await import("../targets/claude/uninstall");
    console.log("");
  }

  if (targets.opencode) {
    console.log("━━━ opencode ━━━");
    await import("../targets/opencode/uninstall");
    console.log("");
  }

  log.success(
    `PAL uninstalled. Your TELOS, skills, and memory are still in ${palHome()}.`
  );
}

async function exportState() {
  const { collectExportFiles, exportZip, timestamp } = await import(
    "../hooks/lib/export"
  );

  const dryRun = args.includes("--dry-run");
  const pathArg = args.find((a) => !a.startsWith("-") && a !== "export");
  const outputPath = pathArg || resolve(palHome(), `pal-export-${timestamp()}.zip`);

  if (dryRun) {
    const files = collectExportFiles();
    if (files.length === 0) {
      console.log("Nothing to export.");
    } else {
      console.log(`Would export ${files.length} files → ${outputPath}\n`);
      for (const f of files) console.log(`  ${f}`);
    }
  } else {
    const count = exportZip(outputPath);
    if (count === 0) {
      console.log("Nothing to export.");
    } else {
      console.log(`Exported ${count} files → ${outputPath}`);
    }
  }
}

async function importState() {
  const { readdirSync, statSync } = await import("node:fs");
  const { createInterface } = await import("node:readline");
  const AdmZip = (await import("adm-zip")).default;

  const home = palHome();
  const dryRun = args.includes("--dry-run");
  const pathArg = args.find((a) => !a.startsWith("-") && a !== "import");

  function findLatest(): string | null {
    const candidates: string[] = [];

    try {
      candidates.push(
        ...readdirSync(home)
          .filter((f) => f.startsWith("pal-export-") && f.endsWith(".zip"))
          .map((f) => resolve(home, f))
      );
    } catch {
      /* empty */
    }

    try {
      const backupDir = resolve(home, "backups");
      candidates.push(
        ...readdirSync(backupDir)
          .filter(
            (f) =>
              (f.startsWith("pal-export-") || f.startsWith("pal-backup-")) &&
              f.endsWith(".zip")
          )
          .map((f) => resolve(backupDir, f))
      );
    } catch {
      /* empty */
    }

    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  }

  let zipPath: string;

  if (pathArg) {
    zipPath = resolve(pathArg);
  } else {
    const latest = findLatest();
    if (!latest) {
      log.error("No export or backup files found. Provide a path: pal import <path>");
      process.exit(1);
    }
    console.log(`Found: ${latest}`);
    const zip = new AdmZip(latest);
    console.log(
      `Contains ${zip.getEntries().length} files, created ${statSync(latest).mtime.toISOString().slice(0, 16).replace("T", " ")}`
    );

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise<string>((res) =>
      rl.question("Import this file? [y/N] ", (a) => {
        rl.close();
        res(a);
      })
    );
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Cancelled.");
      process.exit(0);
    }
    zipPath = latest;
  }

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  if (entries.length === 0) {
    console.log("Archive is empty.");
    process.exit(0);
  }

  if (dryRun) {
    console.log(`Would import ${entries.length} files → ${home}\n`);
    for (const e of entries) console.log(`  ${e.entryName}`);
  } else {
    zip.extractAllTo(home, true);
    console.log(`Imported ${entries.length} files → ${home}`);
    log.info("Run 'pal install' to re-register hooks.");
  }
}

async function status() {
  const { existsSync, readdirSync, readFileSync } = await import("node:fs");

  const home = palHome();
  const pkg = palPkg();
  const isRepo = existsSync(resolve(pkg, ".palroot"));

  const pkgJson = JSON.parse(readFileSync(resolve(pkg, "package.json"), "utf-8"));

  console.log("");
  log.info(`Version:  ${pkgJson.version}`);
  log.info(`Mode:     ${isRepo ? "repo" : "package"}`);
  log.info(`Package:  ${pkg}`);
  log.info(`Home:     ${home}`);
  console.log("");

  // Platform dirs
  log.info(`Claude:   ${platform.claudeDir()}`);
  log.info(`opencode: ${platform.opencodeDir()}`);
  log.info(`Agents:   ${platform.agentsDir()}`);
  console.log("");

  // Counts
  const count = (dir: string, ext?: string) => {
    try {
      const files = readdirSync(dir);
      return ext ? files.filter((f) => f.endsWith(ext)).length : files.length;
    } catch {
      return 0;
    }
  };

  log.info(`TELOS:    ${count(resolve(home, "telos"), ".md")} files`);

  const skillsDir = resolve(platform.agentsDir(), "skills");
  log.info(`Skills:   ${count(skillsDir)} installed`);

  const agentsDir = resolve(platform.claudeDir(), "agents");
  log.info(`Agents:   ${count(agentsDir, ".md")} installed`);

  // Check if hooks are registered
  const settingsPath = resolve(platform.claudeDir(), "settings.json");
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const hookCount = Object.values(settings.hooks || {}).flat().length;
    log.info(`Hooks:    ${hookCount} registered`);
  } catch {
    log.info(`Hooks:    not configured`);
  }
  console.log("");
}

// ── Dispatch ──

switch (command) {
  case "init":
    await init();
    break;
  case "install":
    banner();
    await install();
    break;
  case "uninstall":
    await uninstall();
    break;
  case "export":
    await exportState();
    break;
  case "import":
    await importState();
    break;
  case "status":
    await status();
    break;
  case "--help":
  case "-h":
  case "help":
    showHelp();
    break;
  default:
    if (command) log.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(command ? 1 : 0);
}

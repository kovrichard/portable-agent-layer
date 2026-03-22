#!/usr/bin/env bun
/**
 * PAL CLI — Portable Agent Layer
 *
 * Usage:
 *   pal [claude-args...]              Start a Claude session with session summary on exit
 *   pal cli <command> [options]       Admin commands
 *
 * Admin commands (pal cli ...):
 *   init                              Scaffold PAL home, install hooks for all targets
 *   install [--claude] [--opencode]   Register hooks/skills for targets
 *   uninstall [--claude] [--opencode] Remove hooks/skills for targets
 *   export [path] [--dry-run]         Export user state to zip
 *   import [path] [--dry-run]         Import user state from zip
 *   status                            Show current PAL configuration
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { palHome, palPkg, platform } from "../hooks/lib/paths";
import { log } from "../targets/lib";

const allArgs = process.argv.slice(2);

// ── Route: pal cli <command> or pal [claude-args] ──

if (allArgs[0] === "cli") {
  const [, command, ...args] = allArgs;
  await runCli(command, args);
} else if (allArgs[0] === "--help" || allArgs[0] === "-h" || allArgs[0] === "help") {
  showHelp();
} else {
  await session(allArgs);
}

// ── Session: pal [args] ──

function detectAgent(): string | null {
  const hasClaude =
    spawnSync("claude", ["--version"], {
      stdio: "ignore",
      shell: true,
    }).status === 0;
  const hasOpencode =
    spawnSync("opencode", ["--version"], {
      stdio: "ignore",
      shell: true,
    }).status === 0;

  if (hasClaude) return "claude";
  if (hasOpencode) return "opencode";
  return null;
}

async function session(sessionArgs: string[]) {
  const agent = detectAgent();
  if (!agent) {
    log.error("No supported agent found. Install Claude Code or opencode.");
    process.exit(1);
  }

  const result = spawnSync(agent, sessionArgs, {
    stdio: "inherit",
    shell: true,
  });

  const exitCode = result.status ?? 1;

  // Session summary (Claude only)
  if (agent !== "claude") process.exit(exitCode);
  try {
    const projectsDir = resolve(homedir(), ".claude", "projects");
    if (!existsSync(projectsDir)) process.exit(exitCode);

    // Find most recently modified .jsonl file
    let latestFile = "";
    let latestMtime = 0;

    for (const project of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const dir = resolve(projectsDir, project.name);
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".jsonl")) continue;
        const filepath = resolve(dir, file);
        const { mtimeMs } = statSync(filepath);
        if (mtimeMs > latestMtime) {
          latestMtime = mtimeMs;
          latestFile = filepath;
        }
      }
    }

    if (latestFile) {
      const content = readFileSync(latestFile, "utf-8").trim();
      const lastLine = content.split("\n").pop();
      if (lastLine) {
        const sessionId = JSON.parse(lastLine).sessionId;
        if (sessionId) {
          const summaryScript = resolve(palPkg(), "src", "tools", "session-summary.ts");
          spawnSync("bun", ["run", summaryScript, "--", "--session", sessionId], {
            stdio: "inherit",
          });
        }
      }
    }
  } catch {
    // Silently ignore summary errors
  }

  process.exit(exitCode);
}

// ── CLI dispatcher ──

async function runCli(command: string | undefined, args: string[]) {
  switch (command) {
    case "init":
      await init(args);
      break;
    case "install":
      banner();
      await install(parseTargets(args));
      break;
    case "uninstall":
      await uninstall(args);
      break;
    case "export":
      await exportState(args);
      break;
    case "import":
      await importState(args);
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
}

// ── Helpers ──

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
  Usage:
    pal [claude-args...]                    Start a Claude session
    pal cli <command> [options]             Admin commands

  Admin commands:
    pal cli init [--claude] [--opencode]    Scaffold and install (default: all)
    pal cli install [--claude] [--opencode] Register hooks for targets
    pal cli uninstall [--claude] [--opencode] Remove hooks for targets
    pal cli export [path] [--dry-run]       Export state to zip
    pal cli import [path] [--dry-run]       Import state from zip
    pal cli status                          Show PAL configuration

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
  if (!claude && !opencode) return { claude: true, opencode: true };
  return { claude, opencode };
}

// ── Commands ──

async function init(args: string[]) {
  const { ensureSetupState, isSetupComplete } = await import("../hooks/lib/setup");
  const { scaffoldTelos } = await import("../targets/lib");

  banner();

  const home = palHome();
  const isRepo = existsSync(resolve(palPkg(), ".palroot"));

  if (!isRepo) {
    log.info(`Creating PAL home at ${home}`);
    mkdirSync(resolve(home, "telos"), { recursive: true });
    mkdirSync(resolve(home, "memory"), { recursive: true });
  }

  scaffoldTelos();
  ensureSetupState();

  await install(parseTargets(args));

  console.log("");
  const state = ensureSetupState();
  if (!isSetupComplete(state)) {
    log.info("Start a session — PAL will guide you through first-run setup");
  }
}

async function install(targets: { claude: boolean; opencode: boolean }) {
  if (targets.claude) {
    console.log("━━━ Claude Code ━━━");
    await import("../targets/claude/install");
    console.log("");
  }

  if (targets.opencode) {
    console.log("━━━ opencode ━━━");
    await import("../targets/opencode/install");
    console.log("");
  }

  log.success("Done. Existing config was preserved — only new entries were added.");
}

async function uninstall(args: string[]) {
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

async function exportState(args: string[]) {
  const { collectExportFiles, exportZip, timestamp } = await import(
    "../hooks/lib/export"
  );

  const dryRun = args.includes("--dry-run");
  const pathArg = args.find((a) => !a.startsWith("-"));
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

async function importState(args: string[]) {
  const { statSync } = await import("node:fs");
  const { createInterface } = await import("node:readline");
  const AdmZip = (await import("adm-zip")).default;

  const home = palHome();
  const dryRun = args.includes("--dry-run");
  const pathArg = args.find((a) => !a.startsWith("-"));

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
      log.error("No export or backup files found. Provide a path: pal cli import <path>");
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
    log.info("Run 'pal cli install' to re-register hooks.");
  }
}

async function status() {
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

  log.info(`Claude:   ${platform.claudeDir()}`);
  log.info(`opencode: ${platform.opencodeDir()}`);
  log.info(`Agents:   ${platform.agentsDir()}`);
  console.log("");

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

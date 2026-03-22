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
 *   doctor                            Check prerequisites and system health
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { palHome, palPkg, platform } from "../hooks/lib/paths";
import { getPendingSuggestions } from "../hooks/lib/tags";
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

interface ToolCheck {
  name: string;
  available: boolean;
  version?: string;
}

function checkTool(cmd: string, versionArgs: string[] = ["--version"]): ToolCheck {
  try {
    const result = spawnSync(cmd, versionArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      timeout: 5000,
    });
    if (result.status === 0) {
      const version = (result.stdout?.toString() || "").trim().split("\n")[0];
      return { name: cmd, available: true, version };
    }
  } catch {
    // not found
  }
  return { name: cmd, available: false };
}

function detectAgent(): string | null {
  if (checkTool("claude").available) return "claude";
  if (checkTool("opencode").available) return "opencode";
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
      await install(resolveTargets(args));
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
    case "doctor":
      doctor();
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
    pal cli doctor                          Check prerequisites and health

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

/** Resolve targets against available agents. Errors if explicitly requested but missing. */
function resolveTargets(
  args: string[],
  health?: DoctorResult
): { claude: boolean; opencode: boolean } {
  const requested = parseTargets(args);
  const h = health || doctor(true);
  const explicit = args.some(
    (a) => a === "--claude" || a === "--opencode" || a === "--all"
  );

  if (explicit) {
    // User explicitly requested — error if not available
    if (requested.claude && !h.claude.available) {
      log.error("Claude Code is not installed. Run 'pal cli doctor' for details.");
      process.exit(1);
    }
    if (requested.opencode && !h.opencode.available) {
      log.error("opencode is not installed. Run 'pal cli doctor' for details.");
      process.exit(1);
    }
    return requested;
  }

  // Default (no flags) — install for available agents only
  const targets = {
    claude: h.claude.available,
    opencode: h.opencode.available,
  };

  if (!targets.claude) log.info("Skipping Claude Code (not installed)");
  if (!targets.opencode) log.info("Skipping opencode (not installed)");

  return targets;
}

// ── Hook health ──

interface HookHealth {
  totalErrors: number;
  lastError: string | null;
}

function checkHookHealth(home: string): HookHealth {
  const logPath = resolve(home, "memory", "state", "debug.log");

  try {
    if (!existsSync(logPath)) return { totalErrors: 0, lastError: null };

    const content = readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.includes("] ERROR "));

    // Filter to last 24h
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentErrors = lines.filter((line) => {
      const match = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
      if (!match) return false;
      return new Date(match[1]) > cutoff;
    });

    const lastError =
      recentErrors.length > 0
        ? recentErrors[recentErrors.length - 1]
            .replace(/^\[.*?\] ERROR /, "")
            .slice(0, 120)
        : null;

    return { totalErrors: recentErrors.length, lastError };
  } catch {
    return { totalErrors: 0, lastError: null };
  }
}

// ── Doctor ──

interface DoctorResult {
  bun: ToolCheck;
  claude: ToolCheck;
  opencode: ToolCheck;
  hasAgent: boolean;
}

function doctor(silent = false): DoctorResult {
  // Allow CI/tests to skip agent detection
  if (process.env.PAL_SKIP_DOCTOR === "1") {
    return {
      bun: { name: "bun", available: true, version: Bun.version },
      claude: { name: "claude", available: true },
      opencode: { name: "opencode", available: true },
      hasAgent: true,
    };
  }

  const bun = { name: "bun", available: true, version: Bun.version };
  const claude = checkTool("claude");
  const opencode = checkTool("opencode");
  const hasAgent = claude.available || opencode.available;

  const home = palHome();
  const isRepo = existsSync(resolve(palPkg(), ".palroot"));
  const telosCount = (() => {
    try {
      return readdirSync(resolve(home, "telos")).filter((f) => f.endsWith(".md")).length;
    } catch {
      return 0;
    }
  })();

  if (!silent) {
    const ok = (msg: string) => console.log(`  \x1b[32m\u2713\x1b[0m ${msg}`);
    const warn = (msg: string) => console.log(`  \x1b[33m\u26A0\x1b[0m ${msg}`);
    const fail = (msg: string) => console.log(`  \x1b[31m\u2717\x1b[0m ${msg}`);

    console.log("");
    log.info("Doctor");
    ok(`Bun ${bun.version}`);
    claude.available
      ? ok(`Claude Code ${claude.version || ""}`.trim())
      : fail("Claude Code — not found");
    opencode.available
      ? ok(`opencode ${opencode.version || ""}`.trim())
      : fail("opencode — not found");
    ok(`PAL home: ${home} (${isRepo ? "repo" : "package"} mode)`);
    telosCount > 0 ? ok(`TELOS: ${telosCount} files`) : fail("TELOS: not scaffolded");

    // API key checks
    process.env.ANTHROPIC_API_KEY
      ? ok("ANTHROPIC_API_KEY is set")
      : fail("ANTHROPIC_API_KEY — not set (hooks need it for inference)");
    process.env.GEMINI_API_KEY
      ? ok("GEMINI_API_KEY is set")
      : warn("GEMINI_API_KEY — not set (optional, for YouTube analysis)");

    // Hook health from debug.log
    const hookHealth = checkHookHealth(home);
    if (hookHealth.totalErrors === 0) {
      ok("Hooks: no recent errors");
    } else {
      fail(`Hooks: ${hookHealth.totalErrors} error(s) in last 24h`);
      if (hookHealth.lastError) {
        log.warn(`    Last: ${hookHealth.lastError}`);
      }
    }

    // Pending tag suggestions
    const pending = getPendingSuggestions();
    const pendingEntries = Object.entries(pending).sort((a, b) => b[1] - a[1]);
    if (pendingEntries.length > 0) {
      warn(`Tags: ${pendingEntries.length} pending suggestion(s)`);
      for (const [tag, count] of pendingEntries.slice(0, 5)) {
        log.info(`    "${tag}" (${count}/3 to promote)`);
      }
    } else {
      ok("Tags: no pending suggestions");
    }

    if (!hasAgent) {
      console.log("");
      log.error("No supported agent found. Install Claude Code or opencode.");
    }
    console.log("");
  }

  return { bun, claude, opencode, hasAgent };
}

// ── Commands ──

async function init(args: string[]) {
  const { ensureSetupState, isSetupComplete } = await import("../hooks/lib/setup");
  const { scaffoldTelos } = await import("../targets/lib");

  banner();

  // Run doctor first — abort if no agents available
  const health = doctor(false);
  if (!health.hasAgent) {
    process.exit(1);
  }

  const home = palHome();
  const isRepo = existsSync(resolve(palPkg(), ".palroot"));

  if (!isRepo) {
    log.info(`Creating PAL home at ${home}`);
    mkdirSync(resolve(home, "telos"), { recursive: true });
    mkdirSync(resolve(home, "memory"), { recursive: true });
  }

  scaffoldTelos();
  ensureSetupState();

  // Auto-detect available targets
  const targets = resolveTargets(args, health);
  await install(targets);

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

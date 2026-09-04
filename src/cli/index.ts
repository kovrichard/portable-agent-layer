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
 *   install [--claude] [--opencode] [--cursor] [--codex]   Register hooks/skills for targets
 *   uninstall [--claude] [--opencode] [--cursor] [--codex] Remove hooks/skills for targets
 *   update                             Update PAL (git pull or npm update)
 *   export [path] [--dry-run]         Export user state to zip
 *   import [path] [--dry-run] [--overwrite]  Merge user state from zip
 *   status                            Show current PAL configuration
 *   doctor                            Check prerequisites and system health
 *   usage                             Summarize token usage and cost
 *   skill link <name>                 Link a personal ~/.pal/skills/<name>/ into installed agents
 *   skill doctor <name|--all>         Evaluate one skill, or every installed skill, against the authoring best practices
 *   subagent link <name>             Install a personal ~/.pal/agents/<name>.md into installed agents
 *   subagent doctor <name>           Evaluate a subagent against the authoring best practices
 *   debug [on|off]                    Enable / disable verbose hook debug logging
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  appendImportLog,
  mergeArchive,
  readManifest,
  summarize,
} from "../hooks/lib/import-merge";
import { inference, previewInferenceRoute } from "../hooks/lib/inference";
import { DEBUG_LOG_MAX_ROTATED, logDebug } from "../hooks/lib/log";
import { ensureRegistered, writeRegistryEntry } from "../hooks/lib/machine";
import { palHome, palPkg, paths, platform } from "../hooks/lib/paths";
import { auditBindings, describeBindingIssue } from "../hooks/lib/projects";
import { hasRealContent, SETUP_STEPS, STEP_ORDER } from "../hooks/lib/setup";
import { log } from "../targets/lib";
import { checkPendingMigrations } from "./migrate";

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

/**
 * Copilot ships as a VS Code extension as well as a CLI, and the extension puts
 * no `copilot` binary on PATH — but both read hooks, skills and agents out of
 * ~/.copilot. Fall back to that directory so PAL's copilot checks still run.
 */
function checkCopilot(): ToolCheck {
  const cli = checkTool("copilot", ["version"]);
  if (cli.available) return cli;
  if (existsSync(platform.copilotDir())) {
    return { name: "copilot", available: true, version: "~/.copilot (no CLI on PATH)" };
  }
  return cli;
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

  // Check for updates and display notice
  try {
    const { checkForUpdate, getUpdateNotice } = await import(
      "../hooks/handlers/update-check"
    );
    await checkForUpdate();
    const notice = getUpdateNotice();
    if (notice) console.log(`\n${notice}`);
  } catch {
    // Non-critical
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
    case "update":
      await update();
      break;
    case "status":
      await status();
      break;
    case "doctor": {
      doctor();
      if (args.includes("--probe-inference") || args.includes("--probe")) {
        await probeInference();
      }
      break;
    }
    case "migrate": {
      const { runMigrate } = await import("./migrate");
      runMigrate(args);
      break;
    }
    case "analyze": {
      const { run: runAnalyze } = await import("../tools/agent/analyze");
      await runAnalyze(args);
      break;
    }
    case "usage": {
      const { usage } = await import("../tools/token-cost");
      usage();
      break;
    }
    case "knowledge": {
      const { runKnowledge } = await import("./knowledge");
      const code = await runKnowledge(args);
      if (code !== 0) process.exit(code);
      break;
    }
    case "subagent": {
      const { runSubagent } = await import("./subagent");
      const code = await runSubagent(args);
      if (code !== 0) process.exit(code);
      break;
    }
    case "skill": {
      const { runSkill } = await import("./skill");
      const code = await runSkill(args);
      if (code !== 0) process.exit(code);
      break;
    }
    case "actor":
    case "machine": {
      const { runIdentity } = await import("./identity");
      const code = runIdentity(command, args);
      if (code !== 0) process.exit(code);
      break;
    }
    case "debug":
      cliDebug(args);
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
    pal cli init [--claude] [--opencode] [--cursor] [--codex]    Scaffold and install (default: all)
    pal cli install [--claude] [--opencode] [--cursor] [--codex] Register hooks for targets
    pal cli uninstall [--claude] [--opencode] [--cursor] [--codex] Remove hooks for targets
    pal cli update                          Update PAL (git pull or npm update)
    pal cli export [path] [--dry-run]       Export state to zip
    pal cli import [path] [--dry-run]       Merge state from zip (--overwrite to replace)
    pal cli status                          Show PAL configuration
    pal cli doctor [--probe-inference]      Check prerequisites and health (--probe fires real inference per route)
    pal cli migrate [--list] [--dry-run]    Run pending data migrations
    pal cli analyze [--actionable]          Learning analysis: ratings, failure patterns, graduation candidates
    pal cli usage                           Summarize token usage and cost
    pal cli actor [label <name>]            Show or rename this actor (who caused a record)
    pal cli machine [label <name>]          Show or rename this install (where it was written)
    pal cli knowledge <sub> [args]          Query & manage the knowledge store
                                            (search · graph · stats · hubs · find · show · add · ls)
    pal cli skill link <name>               Link a personal ~/.pal/skills/<name>/ into installed agents
    pal cli skill doctor <name|--all>       Evaluate one skill, or every installed skill
    pal cli skill author-model              Print the flagship model that authors skills for the active agent
    pal cli subagent link <name>            Install a personal ~/.pal/agents/<name>.md into installed agents
    pal cli subagent doctor <name>          Evaluate a subagent against the authoring best practices
    pal cli subagent list                   List the user-authored subagents in ~/.pal/agents/
    pal cli subagent author-model           Print the flagship model that authors subagents for the active agent
    pal cli debug [on|off]                  Enable/disable verbose hook debug logging (persisted)

  Environment:
    PAL_HOME              Override user state directory (default: ~/.pal or repo root)
    PAL_PKG               Override package root
    PAL_CLAUDE_DIR        Override Claude config dir (default: ~/.claude)
    PAL_OPENCODE_DIR      Override opencode config dir (default: ~/.config/opencode)
    PAL_CURSOR_DIR        Override Cursor config dir (default: ~/.cursor)
    PAL_COPILOT_DIR       Override Copilot config dir (default: ~/.copilot)
    PAL_CODEX_DIR         Override Codex config dir (default: ~/.codex)
    PAL_AGENTS_DIR        Override agents dir (default: ~/.agents)
`);
}

type Targets = {
  claude: boolean;
  opencode: boolean;
  cursor: boolean;
  copilot: boolean;
  codex: boolean;
};

function parseTargets(args: string[]): Targets {
  let claude = false;
  let opencode = false;
  let cursor = false;
  let copilot = false;
  let codex = false;
  for (const arg of args) {
    if (arg === "--claude") claude = true;
    else if (arg === "--opencode") opencode = true;
    else if (arg === "--cursor") cursor = true;
    else if (arg === "--copilot") copilot = true;
    else if (arg === "--codex") codex = true;
    else if (arg === "--all") {
      claude = true;
      opencode = true;
      cursor = true;
      copilot = true;
      codex = true;
    }
  }
  if (!claude && !opencode && !cursor && !copilot && !codex)
    return { claude: true, opencode: true, cursor: true, copilot: true, codex: true };
  return { claude, opencode, cursor, copilot, codex };
}

/** Resolve targets against available agents. Errors if explicitly requested but missing. */
function resolveTargets(args: string[], health?: DoctorResult): Targets {
  const requested = parseTargets(args);
  const h = health || doctor(true);
  const explicit = args.some(
    (a) =>
      a === "--claude" ||
      a === "--opencode" ||
      a === "--cursor" ||
      a === "--copilot" ||
      a === "--codex" ||
      a === "--all"
  );

  if (explicit) {
    if (requested.claude && !h.claude.available) {
      log.error("Claude Code is not installed. Run 'pal cli doctor' for details.");
      process.exit(1);
    }
    if (requested.opencode && !h.opencode.available) {
      log.error("opencode is not installed. Run 'pal cli doctor' for details.");
      process.exit(1);
    }
    if (requested.cursor && !h.cursor.available) {
      log.error("Cursor is not installed. Run 'pal cli doctor' for details.");
      process.exit(1);
    }
    if (requested.copilot && !h.copilot.available) {
      log.error("Copilot is not installed. Run 'pal cli doctor' for details.");
      process.exit(1);
    }
    if (requested.codex && !h.codex.available) {
      log.error("Codex is not installed. Run 'pal cli doctor' for details.");
      process.exit(1);
    }
    return requested;
  }

  // Default (no flags) — install for available agents only
  const targets: Targets = {
    claude: h.claude.available,
    opencode: h.opencode.available,
    cursor: h.cursor.available,
    copilot: h.copilot.available,
    codex: h.codex.available,
  };

  if (!targets.claude) log.info("Skipping Claude Code (not installed)");
  if (!targets.opencode) log.info("Skipping opencode (not installed)");
  if (!targets.cursor) log.info("Skipping Cursor (not installed)");
  if (!targets.copilot) log.info("Skipping Copilot (not installed)");
  if (!targets.codex) log.info("Skipping Codex (not installed)");

  return targets;
}

// ── Hook health ──

interface HookHealth {
  totalErrors: number;
  lastError: string | null;
}

function checkClaudeHooksRegistered(): boolean {
  const settingsPath = resolve(platform.claudeDir(), "settings.json");
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const groups = settings?.hooks?.SessionStart;
    if (!Array.isArray(groups)) return false;
    return groups.some((g: { hooks?: { command?: string }[] }) =>
      g?.hooks?.some((h) => h?.command?.includes("LoadContext"))
    );
  } catch {
    return false;
  }
}

function checkCursorHooksRegistered(): boolean {
  const hooksPath = resolve(platform.cursorDir(), "hooks.json");
  if (!existsSync(hooksPath)) return false;
  try {
    const data = JSON.parse(readFileSync(hooksPath, "utf-8"));
    const hooks = data?.hooks?.sessionStart;
    if (!Array.isArray(hooks)) return false;
    return hooks.some((h: { command?: string }) => h?.command?.includes("LoadContext"));
  } catch {
    return false;
  }
}

function checkOpencodePluginInstalled(): boolean {
  return existsSync(resolve(platform.opencodeDir(), "plugins", "pal-plugin.ts"));
}

function checkCopilotHooksRegistered(): boolean {
  return existsSync(resolve(platform.copilotDir(), "hooks", "pal-hooks.json"));
}

function checkCodexHooksRegistered(): boolean {
  const hooksPath = resolve(platform.codexDir(), "hooks.json");
  if (!existsSync(hooksPath)) return false;
  try {
    const data = JSON.parse(readFileSync(hooksPath, "utf-8"));
    const entries = data?.hooks?.SessionStart;
    if (!Array.isArray(entries)) return false;
    return entries.some((entry: { command?: string; hooks?: { command?: string }[] }) => {
      if (entry?.command?.includes("LoadContext")) return true;
      return entry?.hooks?.some((h) => h?.command?.includes("LoadContext")) ?? false;
    });
  } catch {
    return false;
  }
}

function checkCopilotInstructionsPresent(): boolean {
  return existsSync(resolve(platform.copilotDir(), "copilot-instructions.md"));
}

// ── Install integrity (Tier 2 doctor checks) ──

/** Hook-config keys that carry a shell command: cross-platform and per-shell variants. */
function isHookCommandField(key: string): boolean {
  return key === "command" || key === "bash" || key === "powershell";
}

/** Recursively collect every command-carrying field value in a hook-config JSON. */
function extractAllHookCommands(obj: unknown, out: string[] = []): string[] {
  if (Array.isArray(obj)) {
    for (const item of obj) extractAllHookCommands(item, out);
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (isHookCommandField(k) && typeof v === "string") {
        out.push(v);
      } else {
        extractAllHookCommands(v, out);
      }
    }
  }
  return out;
}

interface HookPrefixCheck {
  ok: boolean;
  total: number;
  missing: number;
  firstMissing?: string;
}

/**
 * True when a hook command names its agent, by env prefix or by argv flag.
 *
 * An env prefix only parses in one shell family, so hook configs whose host
 * shell is unknown declare the agent with a shell-agnostic `--agent=` flag.
 */
function declaresAgent(cmd: string, agentName: string): boolean {
  return (
    cmd.startsWith(`PAL_AGENT=${agentName} `) ||
    cmd.startsWith(`$env:PAL_AGENT='${agentName}'; `) ||
    cmd.includes(`--agent=${agentName}`)
  );
}

/** Verify every command in an installed hook file names `<agent>` as its agent. */
function checkAgentHookPrefix(filePath: string, agentName: string): HookPrefixCheck {
  if (!existsSync(filePath)) return { ok: false, total: 0, missing: 0 };
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    const commands = extractAllHookCommands(data.hooks ?? data);
    const missing = commands.filter((c) => !declaresAgent(c, agentName));
    return {
      ok: commands.length > 0 && missing.length === 0,
      total: commands.length,
      missing: missing.length,
      firstMissing: missing[0]?.slice(0, 80),
    };
  } catch {
    return { ok: false, total: 0, missing: 0 };
  }
}

interface FreshnessCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Verify the installed opencode plugin is at least as new as the source. Catches
 * the "stale install" failure mode we hit live — plugin file is a copy, not a
 * symlink, so source edits don't reach the running opencode until reinstall.
 */
/**
 * Probe every supported agent route with a tiny real inference call.
 * Sequential (concurrent multi-CLI spawns trigger the empty-abort race we
 * already mitigate but don't want to invite). Each probe temporarily sets
 * PAL_AGENT then restores; doesn't pollute user shell.
 *
 * Triggered by `pal cli doctor --probe-inference` (opt-in: costs tokens).
 */
async function probeInference(): Promise<void> {
  console.log("");
  log.info("Inference probe (live calls, ~5-60s each)");
  const green = "\x1b[32m";
  const red = "\x1b[31m";
  const yellow = "\x1b[33m";
  const dim = "\x1b[90m";
  const reset = "\x1b[0m";
  const agents = ["claude", "codex", "opencode", "copilot", "cursor"] as const;
  const savedAgent = process.env.PAL_AGENT;
  try {
    for (const agent of agents) {
      process.env.PAL_AGENT = agent;
      const preview = previewInferenceRoute();
      const tag = `${agent.padEnd(10)} → ${preview.route.padEnd(15)}`;
      if (preview.route === "none") {
        console.log(`  ${dim}-${reset} ${tag} ${dim}(skip: ${preview.reason})${reset}`);
        continue;
      }
      if (preview.route === "disabled") {
        console.log(`  ${yellow}⚠${reset} ${tag} ${dim}${preview.reason}${reset}`);
        continue;
      }
      const start = Date.now();
      const r = await inference({
        user: "Reply with exactly: OK",
        system: "Reply in 3 words or fewer.",
        caller: "doctor-probe",
        timeout: 60_000,
      });
      const elapsedMs = Date.now() - start;
      if (r.success) {
        const bytes = r.output?.length ?? 0;
        console.log(
          `  ${green}✓${reset} ${tag} ${String(elapsedMs).padStart(6)}ms  bytes=${bytes}`
        );
      } else {
        console.log(
          `  ${red}✗${reset} ${tag} ${String(elapsedMs).padStart(6)}ms  ${dim}failed — see ~/.pal/memory/state/debug.log${reset}`
        );
      }
    }
  } finally {
    if (savedAgent === undefined) delete process.env.PAL_AGENT;
    else process.env.PAL_AGENT = savedAgent;
  }
}

function checkOpencodePluginFresh(): FreshnessCheck {
  const installedPath = resolve(platform.opencodeDir(), "plugins", "pal-plugin.ts");
  const sourcePath = resolve(palPkg(), "src", "targets", "opencode", "plugin.ts");
  if (!existsSync(installedPath))
    return { ok: false, reason: "installed plugin missing" };
  if (!existsSync(sourcePath)) return { ok: true }; // can't compare; assume installed is fine
  try {
    const installedMtime = statSync(installedPath).mtimeMs;
    const sourceMtime = statSync(sourcePath).mtimeMs;
    if (installedMtime >= sourceMtime) return { ok: true };
    const ageMin = Math.round((sourceMtime - installedMtime) / 60000);
    return {
      ok: false,
      reason: `source is ${ageMin}m newer than installed — run 'pal cli install --opencode'`,
    };
  } catch {
    return { ok: true };
  }
}

function playwrightBrowsersPath(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  const home = homedir();
  if (process.platform === "darwin") return resolve(home, "Library/Caches/ms-playwright");
  if (process.platform === "win32") return resolve(home, "AppData/Local/ms-playwright");
  return resolve(home, ".cache/ms-playwright");
}

function checkPlaywrightChromium(): boolean {
  const base = playwrightBrowsersPath();
  if (!existsSync(base)) return false;
  try {
    return readdirSync(base).some((f) => f.startsWith("chromium-"));
  } catch {
    return false;
  }
}

interface NodeCheck {
  available: boolean;
  version?: string;
  meetsMinimum?: boolean;
}

// Minimum Node version with `--experimental-strip-types` is 22.6.0 — required
// by the consulting-report skill, which runs under Node on Windows because
// Playwright's chromium.launch() hangs under Bun.
function checkNode(): NodeCheck {
  const minMajor = 22;
  const minMinor = 6;
  const result = checkTool("node");
  if (!result.available) return { available: false };
  const raw = (result.version || "").replace(/^v/, "");
  const [majorStr = "", minorStr = ""] = raw.split(".");
  const major = Number(majorStr);
  const minor = Number(minorStr);
  const meetsMinimum =
    Number.isFinite(major) &&
    Number.isFinite(minor) &&
    (major > minMajor || (major === minMajor && minor >= minMinor));
  return { available: true, version: raw, meetsMinimum };
}

function nodeInstallHint(): string {
  if (process.platform === "win32")
    return "install Node ≥ 22.6 (`winget install OpenJS.NodeJS.LTS` or https://nodejs.org)";
  if (process.platform === "darwin")
    return "install Node ≥ 22.6 (`brew install node` or https://nodejs.org)";
  return "install Node ≥ 22.6 (see https://nodejs.org or your package manager)";
}

function rtkInstallHint(): string {
  if (process.platform === "win32")
    return "download rtk.exe from https://github.com/rtk-ai/rtk/releases and add it to PATH";
  if (process.platform === "darwin") return "`brew install rtk`";
  return "`curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh`";
}

function checkHookHealth(home: string): HookHealth {
  const stateDir = resolve(home, "memory", "state");
  // Read current + all rotated logs (`.1`..`.5`) + legacy `.prev` so a recent
  // rotation doesn't make the 24h window appear empty.
  const candidates = [
    resolve(stateDir, "debug.log"),
    resolve(stateDir, "debug.log.prev"),
    ...Array.from({ length: DEBUG_LOG_MAX_ROTATED }, (_, i) =>
      resolve(stateDir, `debug.log.${i + 1}`)
    ),
  ];

  try {
    let content = "";
    for (const path of candidates) {
      if (existsSync(path)) content += `${readFileSync(path, "utf-8")}\n`;
    }
    if (!content) return { totalErrors: 0, lastError: null };

    const lines = content.split("\n").filter((l) => l.includes("] ERROR "));

    // Filter to last 24h
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentErrors = lines.filter((line) => {
      const match = new RegExp(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/).exec(line);
      if (!match) return false;
      return new Date(match[1]) > cutoff;
    });

    const lastError =
      recentErrors.length > 0
        ? (recentErrors.at(-1) ?? "").replace(/^\[.*?\] ERROR /, "").slice(0, 120)
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
  cursor: ToolCheck;
  copilot: ToolCheck;
  codex: ToolCheck;
  rtk: ToolCheck;
  hasAgent: boolean;
}

function doctor(silent = false): DoctorResult {
  // Allow CI/tests to skip agent detection
  if (process.env.PAL_SKIP_DOCTOR === "1") {
    return {
      bun: { name: "bun", available: true, version: Bun.version },
      claude: { name: "claude", available: true },
      opencode: { name: "opencode", available: true },
      cursor: { name: "cursor", available: true },
      copilot: { name: "copilot", available: true },
      codex: { name: "codex", available: true },
      rtk: { name: "rtk", available: true },
      hasAgent: true,
    };
  }

  const bun = { name: "bun", available: true, version: Bun.version };
  const claude = checkTool("claude");
  const opencode = checkTool("opencode");
  const cursor = checkTool("cursor");
  const copilot = checkCopilot();
  const codex = checkTool("codex");
  const rtk = checkTool("rtk");
  const hasAgent =
    claude.available ||
    opencode.available ||
    cursor.available ||
    copilot.available ||
    codex.available;

  const home = palHome();
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
    const info = (msg: string) => console.log(`  \x1b[90m\u00B7\x1b[0m ${msg}`);

    console.log("");
    log.info("Prerequisites");
    ok(`Bun ${bun.version}`);
    const node = checkNode();
    if (!node.available) {
      warn(
        `Node — not found; consulting-report PDF skill will not work. ${nodeInstallHint()}`
      );
    } else if (!node.meetsMinimum) {
      warn(
        `Node ${node.version} — too old for consulting-report PDF skill (needs ≥ 22.6 for --experimental-strip-types). ${nodeInstallHint()}`
      );
    } else {
      ok(`Node ${node.version}`);
    }
    claude.available
      ? ok(`Claude Code ${claude.version || ""}`.trim())
      : fail("Claude Code — not found");
    opencode.available
      ? ok(`opencode ${opencode.version || ""}`.trim())
      : fail("opencode — not found");
    cursor.available
      ? ok(`Cursor ${cursor.version || ""}`.trim())
      : fail("Cursor — not found");
    copilot.available
      ? ok(`Copilot ${copilot.version || ""}`.trim())
      : fail("Copilot — not found");
    codex.available
      ? ok(`Codex ${codex.version || ""}`.trim())
      : fail("Codex — not found");
    checkPlaywrightChromium()
      ? ok("Playwright Chromium installed")
      : fail(
          "Playwright Chromium — not found (run 'pal cli install' or 'bunx playwright install chromium')"
        );
    rtk.available
      ? ok(rtk.version || "rtk")
      : info(
          `rtk — not installed (optional; enables Bash output compression — ${rtkInstallHint()})`
        );

    console.log("");
    log.info("PAL state");
    ok(`PAL home: ${home}`);
    telosCount > 0 ? ok(`TELOS: ${telosCount} files`) : fail("TELOS: not scaffolded");

    // Identity
    const palSettingsPath = resolve(home, "memory", "pal-settings.json");
    if (existsSync(palSettingsPath)) {
      try {
        const s = JSON.parse(readFileSync(palSettingsPath, "utf-8"));
        const hasIdentity = s?.identity?.principal?.name && s?.identity?.ai?.name;
        hasIdentity
          ? ok("Identity configured")
          : warn("Identity — incomplete (run 'pal cli install')");
      } catch {
        warn("Identity — could not read pal-settings.json");
      }
    } else {
      warn("Identity — pal-settings.json missing (run 'pal cli install')");
    }

    // AGENTS.md
    const agentsMdPath = resolve(platform.opencodeDir(), "AGENTS.md");
    existsSync(agentsMdPath)
      ? ok("AGENTS.md present")
      : fail("AGENTS.md — missing (run 'pal cli install')");

    if (claude.available) {
      const claudeMdPath = resolve(platform.claudeDir(), "CLAUDE.md");
      existsSync(claudeMdPath)
        ? ok("CLAUDE.md present")
        : fail("CLAUDE.md — missing (run 'pal cli install --claude')");
    }

    // Setup state — check file content directly (no setup.json dependency)
    {
      const missing = STEP_ORDER.filter(
        (key) => !hasRealContent(resolve(home, SETUP_STEPS[key].file))
      );
      missing.length === 0
        ? ok("TELOS setup complete")
        : warn(
            `TELOS setup incomplete — ${missing.join(", ")} missing (run 'pal cli install')`
          );
    }

    // Project bindings — where each project lives on THIS machine
    {
      const issues = auditBindings();
      if (issues.length === 0) {
        ok("Project bindings healthy");
      } else {
        for (const issue of issues) warn(`Binding: ${describeBindingIssue(issue)}`);
      }
    }

    // Dependencies (PAL's own npm packages)
    const nodeModulesPath = resolve(palPkg(), "node_modules");
    existsSync(nodeModulesPath)
      ? ok("Dependencies installed")
      : fail("Dependencies missing — run 'pal cli install'");

    // Skills (per installed agent)
    console.log("");
    log.info("Skills");
    const countSkillsIn = (dir: string) =>
      existsSync(dir)
        ? readdirSync(dir).filter((f) => existsSync(resolve(dir, f, "SKILL.md"))).length
        : 0;
    if (claude.available) {
      const n = countSkillsIn(resolve(platform.claudeDir(), "skills"));
      n > 0
        ? ok(`Claude Code skills: ${n}`)
        : warn("Claude Code skills — none found (run 'pal cli install --claude')");
    }
    if (opencode.available) {
      const n = countSkillsIn(resolve(platform.agentsDir(), "skills"));
      n > 0
        ? ok(`opencode skills: ${n}`)
        : warn("opencode skills — none found (run 'pal cli install --opencode')");
    }
    if (cursor.available) {
      const n = countSkillsIn(resolve(platform.cursorDir(), "skills"));
      n > 0
        ? ok(`Cursor skills: ${n}`)
        : warn("Cursor skills — none found (run 'pal cli install --cursor')");
    }
    if (copilot.available) {
      const n = countSkillsIn(resolve(platform.copilotDir(), "skills"));
      n > 0
        ? ok(`Copilot skills: ${n}`)
        : warn("Copilot skills — none found (run 'pal cli install --copilot')");
    }
    if (codex.available) {
      const n = countSkillsIn(resolve(platform.codexDir(), "skills"));
      n > 0
        ? ok(`Codex skills: ${n}`)
        : warn("Codex skills — none found (run 'pal cli install --codex')");
    }

    // Hook registration (per installed agent)
    console.log("");
    log.info("Hooks");
    if (claude.available) {
      checkClaudeHooksRegistered()
        ? ok("Claude Code hooks registered")
        : fail("Claude Code hooks — not registered (run 'pal cli install --claude')");
    }
    if (opencode.available) {
      checkOpencodePluginInstalled()
        ? ok("opencode plugin installed")
        : fail("opencode plugin — not installed (run 'pal cli install --opencode')");
    }
    if (cursor.available) {
      checkCursorHooksRegistered()
        ? ok("Cursor hooks registered")
        : fail("Cursor hooks — not registered (run 'pal cli install --cursor')");
    }
    if (copilot.available) {
      checkCopilotHooksRegistered()
        ? ok("Copilot hooks registered")
        : fail("Copilot hooks — not registered (run 'pal cli install --copilot')");
      checkCopilotInstructionsPresent()
        ? ok("copilot-instructions.md present")
        : warn("copilot-instructions.md missing (run 'pal cli install --copilot')");
    }
    if (codex.available) {
      checkCodexHooksRegistered()
        ? ok("Codex hooks registered")
        : fail("Codex hooks — not registered (run 'pal cli install --codex')");
    }

    // Install integrity — verify PAL_AGENT prefix on every command in installed
    // hook files. Catches stale installs after template changes (the exact bug
    // we hit live for opencode + copilot). opencode uses a plugin file instead
    // of a hooks.json, so it gets a separate freshness check.
    console.log("");
    log.info("Install integrity");
    const prefixCheck = (
      filePath: string,
      agentName: string,
      installCmd: string
    ): void => {
      const r = checkAgentHookPrefix(filePath, agentName);
      if (r.ok) {
        ok(`${agentName}: declared on all ${r.total} hook commands`);
      } else if (r.total === 0) {
        fail(`${agentName}: hook file missing or unreadable at ${filePath}`);
      } else {
        fail(
          `${agentName}: ${r.missing}/${r.total} hook commands do not declare ${agentName} (run '${installCmd}')`
        );
        if (r.firstMissing) {
          log.warn(`    First offender: ${r.firstMissing}…`);
        }
      }
    };
    if (claude.available) {
      prefixCheck(
        resolve(platform.claudeDir(), "settings.json"),
        "claude",
        "pal cli install --claude"
      );
    }
    if (cursor.available) {
      prefixCheck(
        resolve(platform.cursorDir(), "hooks.json"),
        "cursor",
        "pal cli install --cursor"
      );
    }
    if (copilot.available) {
      prefixCheck(
        resolve(platform.copilotDir(), "hooks", "pal-hooks.json"),
        "copilot",
        "pal cli install --copilot"
      );
    }
    if (codex.available) {
      prefixCheck(
        resolve(platform.codexDir(), "hooks.json"),
        "codex",
        "pal cli install --codex"
      );
    }
    if (opencode.available) {
      const fresh = checkOpencodePluginFresh();
      fresh.ok
        ? ok("opencode plugin: source-and-installed in sync")
        : fail(`opencode plugin: ${fresh.reason}`);
    }

    // Inference routing preview — what `inference()` would do RIGHT NOW
    console.log("");
    log.info("Inference");
    {
      const preview = previewInferenceRoute();
      console.log(`  → Active agent: ${preview.agent}`);
      if (preview.route === "none") {
        fail(`Would route to: NONE — ${preview.reason}`);
      } else if (preview.route === "disabled") {
        warn(`Would route to: DISABLED — ${preview.reason}`);
      } else if (preview.route.endsWith("-api")) {
        warn(`Would route to: ${preview.route} (${preview.reason})`);
      } else {
        ok(`Would route to: ${preview.route} (${preview.reason})`);
      }
    }
    if (process.env.PAL_INFERENCE_DISABLED === "1") {
      warn(
        "PAL_INFERENCE_DISABLED=1 — test kill-switch leaked into prod env; every inference call will return failure"
      );
    } else {
      ok("PAL_INFERENCE_DISABLED is not set (production-safe)");
    }

    // Spawn-guard env vars should never appear in the user's shell — they're
    // set ONLY in PAL-spawned subprocesses. Leaks into the user shell cause
    // every inference call to short-circuit silently.
    if (process.env.PAL_SPAWNED_INFERENCE) {
      fail(
        `PAL_SPAWNED_INFERENCE=${process.env.PAL_SPAWNED_INFERENCE} leaked into shell — every inference call will refuse. Unset it.`
      );
    } else {
      ok("PAL_SPAWNED_INFERENCE not leaked (recursion guard clean)");
    }
    if (process.env.PAL_INFERENCE_DEPTH) {
      fail(
        `PAL_INFERENCE_DEPTH=${process.env.PAL_INFERENCE_DEPTH} leaked into shell — depth circuit-breaker will fire. Unset it.`
      );
    } else {
      ok("PAL_INFERENCE_DEPTH not leaked (depth counter clean)");
    }

    // API key checks — both are optional safety-net fallbacks. Unset is normal
    // for CLI-only setups; only matters if your native CLI breaks.
    process.env.PAL_ANTHROPIC_API_KEY
      ? ok("PAL_ANTHROPIC_API_KEY set (anthropic-api fallback available)")
      : info("PAL_ANTHROPIC_API_KEY unset (optional — anthropic-api fallback off)");
    process.env.PAL_OPENAI_API_KEY
      ? ok("PAL_OPENAI_API_KEY set (openai-api fallback for codex available)")
      : info("PAL_OPENAI_API_KEY unset (optional — openai-api fallback off)");
    process.env.PAL_GEMINI_API_KEY
      ? ok("PAL_GEMINI_API_KEY is set")
      : warn("PAL_GEMINI_API_KEY — not set (optional, for YouTube analysis)");
    process.env.PAL_XAI_API_KEY
      ? ok("PAL_XAI_API_KEY is set")
      : warn("PAL_XAI_API_KEY — not set (optional, for Grok researcher)");
    process.env.PAL_PERPLEXITY_API_KEY
      ? ok("PAL_PERPLEXITY_API_KEY is set")
      : warn("PAL_PERPLEXITY_API_KEY — not set (optional, for Perplexity researcher)");

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

    // Pending migrations
    const pendingMigrations = checkPendingMigrations();
    if (pendingMigrations.length > 0) {
      for (const m of pendingMigrations) {
        const detail = m.detail ? ` (${m.detail})` : "";
        warn(
          `Migration pending: ${m.id} — ${m.description}${detail} → run 'pal cli migrate'`
        );
      }
    }

    if (!hasAgent) {
      console.log("");
      log.error("No supported agent found. Install Claude Code or opencode.");
    }
    console.log("");
  }

  return { bun, claude, opencode, cursor, copilot, codex, rtk, hasAgent };
}

// ── Commands ──

async function init(args: string[]) {
  const { scaffoldTelos } = await import("../targets/lib");

  banner();

  // Run doctor first — abort if no agents available
  const health = doctor(false);
  if (!health.hasAgent) {
    process.exit(1);
  }

  const home = palHome();
  log.info(`Creating PAL home at ${home}`);
  mkdirSync(resolve(home, "telos"), { recursive: true });
  mkdirSync(resolve(home, "memory"), { recursive: true });
  // Scaffolded here, not left to generateSkillIndex: that returns early when
  // ~/.pal/skills is absent, so an init that installs no skills would leave
  // every writer of memory/state with nowhere to write.
  mkdirSync(resolve(home, "memory", "state"), { recursive: true });

  scaffoldTelos();

  // Auto-detect available targets
  const targets = resolveTargets(args, health);
  await install(targets);
}

/**
 * Run a setup subprocess, showing its output only when it fails.
 *
 * These are idempotent and usually report "no changes", so their banners are
 * pure noise on a re-install — but the moment one fails, the reason it gives
 * is the only thing that explains the warning.
 */
function runQuietly(cmd: string, args: string[], cwd: string): number | null {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf-8", shell: true });
  if (r.status !== 0) process.stderr.write((r.stdout ?? "") + (r.stderr ?? ""));
  return r.status;
}

async function install(targets: Targets) {
  // Ensure dependencies are installed
  const pkg = palPkg();
  if (runQuietly("bun", ["install", "--frozen-lockfile"], pkg) !== 0) {
    log.warn("bun install failed — continuing anyway, but hooks may not work");
  }

  // Fetch the Chromium build Playwright uses for PDF rendering (create-pdf skill).
  // Idempotent — skipped if already cached. Skipped entirely under PAL_SKIP_BROWSER_INSTALL=1
  // (used by tests to avoid a ~150MB download on every run).
  // Uses `bun x` (not `bunx`) for Windows compatibility — bunx resolves unreliably under cmd.exe.
  if (process.env.PAL_SKIP_BROWSER_INSTALL !== "1") {
    const pw = runQuietly("bun", ["x", "playwright", "install", "chromium"], pkg);
    if (pw !== 0) {
      log.warn(
        `playwright install chromium failed (exit ${pw}) — create-pdf and consulting-report skills won't work. Retry manually: bun x playwright install chromium`
      );
    }
  }

  // Node check — the consulting-report skill runs under `node --experimental-strip-types`
  // because Playwright's chromium.launch() hangs under Bun on Windows (CDP handshake over
  // stdio pipes). Node ≥ 22.6 is required for --experimental-strip-types.
  const node = checkNode();
  if (!node.available) {
    log.warn(
      `Node not found — consulting-report PDF skill will not work. ${nodeInstallHint()}`
    );
  } else if (!node.meetsMinimum) {
    log.warn(
      `Node ${node.version} is older than 22.6 — consulting-report PDF skill will not work (needs --experimental-strip-types). ${nodeInstallHint()}`
    );
  }

  // Scaffold TELOS + PAL settings, then prompt for missing identity
  const { scaffoldTelos, scaffoldPalSettings, copyPalDocs, generateSkillIndex } =
    await import("../targets/lib");
  const { promptIdentity } = await import("./setup-identity");
  const { promptTelos } = await import("./setup-telos");
  const { promptAttribution } = await import("./setup-attribution");
  scaffoldTelos();
  scaffoldPalSettings();
  await promptIdentity();
  await promptTelos();
  await promptAttribution();

  // Registers the label loadActor derives, so it travels on the next export.
  const { ensureActorRegistered } = await import("../hooks/lib/actor");
  ensureActorRegistered();

  // Shared, target-independent state. Every target installer used to repeat these
  // identical calls; AGENTS.md in particular must exist before any target symlinks
  // to it, so it runs once here rather than once per target.
  const { regenerateIfNeeded } = await import("../hooks/lib/claude-md");
  const palDocsCount = copyPalDocs();
  regenerateIfNeeded();

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

  if (targets.cursor) {
    console.log("━━━ Cursor ━━━");
    await import("../targets/cursor/install");
    console.log("");
  }

  if (targets.copilot) {
    console.log("━━━ Copilot ━━━");
    await import("../targets/copilot/install");
    console.log("");
  }

  if (targets.codex) {
    console.log("━━━ Codex ━━━");
    await import("../targets/codex/install");
    console.log("");
  }

  // The rest of the shared work reads what the installers just wrote: the index
  // walks ~/.pal/skills, and the digests land in ~/.cursor/rules and
  // ~/.copilot/instructions, which are skipped when the agent's home is absent.
  const { writeContextDigests } = await import("../hooks/handlers/context-digests");
  const indexedSkills = generateSkillIndex();
  writeContextDigests();
  log.success(
    `Shared: ${indexedSkills} skills indexed · ${palDocsCount} docs → ~/.pal/docs/ · AGENTS.md + context digests written`
  );

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

  if (targets.cursor) {
    console.log("━━━ Cursor ━━━");
    await import("../targets/cursor/uninstall");
    console.log("");
  }

  if (targets.copilot) {
    console.log("━━━ Copilot ━━━");
    await import("../targets/copilot/uninstall");
    console.log("");
  }

  if (targets.codex) {
    console.log("━━━ Codex ━━━");
    await import("../targets/codex/uninstall");
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
  const resolvedArg = pathArg ? resolve(pathArg) : null;
  const argIsDir =
    resolvedArg !== null &&
    existsSync(resolvedArg) &&
    statSync(resolvedArg).isDirectory();
  const outputPath = argIsDir
    ? resolve(resolvedArg, `pal-export-${timestamp()}.zip`)
    : (resolvedArg ?? resolve(palHome(), `pal-export-${timestamp()}.zip`));

  logDebug("export", `start dryRun=${dryRun} outputPath=${outputPath}`);
  if (dryRun) {
    const files = collectExportFiles();
    logDebug("export", `dry-run collected ${files.length} files`);
    if (files.length === 0) {
      console.log("Nothing to export.");
    } else {
      console.log(`Would export ${files.length} files → ${outputPath}\n`);
      for (const f of files) console.log(`  ${f}`);
    }
  } else {
    const count = exportZip(outputPath);
    logDebug("export", `done count=${count} path=${outputPath}`);
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
  const overwrite = args.includes("--overwrite");
  const pathArg = args.find((a) => !a.startsWith("-"));
  logDebug("import", `start dryRun=${dryRun} pathArg=${pathArg ?? "(auto)"}`);

  function findLatestIn(dirs: string[]): string | null {
    const candidates: string[] = [];
    for (const dir of dirs) {
      try {
        candidates.push(
          ...readdirSync(dir)
            .filter(
              (f) =>
                (f.startsWith("pal-export-") || f.startsWith("pal-backup-")) &&
                f.endsWith(".zip")
            )
            .map((f) => resolve(dir, f))
        );
      } catch {
        /* empty */
      }
    }
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  }

  let zipPath: string;

  const resolvedArg = pathArg ? resolve(pathArg) : null;
  const argIsDir =
    resolvedArg !== null &&
    existsSync(resolvedArg) &&
    statSync(resolvedArg).isDirectory();

  if (resolvedArg && !argIsDir) {
    zipPath = resolvedArg;
    logDebug("import", `using provided path=${zipPath}`);
  } else {
    const searchDirs = argIsDir ? [resolvedArg] : [home, resolve(home, "backups")];
    logDebug("import", `searching dirs=${searchDirs.join(",")}`);
    const latest = findLatestIn(searchDirs);
    if (!latest) {
      logDebug("import", "no export/backup files found");
      log.error("No export or backup files found. Provide a path: pal cli import <path>");
      process.exit(1);
    }
    logDebug("import", `auto-selected latest=${latest}`);
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

  logDebug(
    "import",
    `zip=${zipPath} entries=${entries.length} dryRun=${dryRun} overwrite=${overwrite}`
  );
  if (dryRun) {
    console.log(
      `Would ${overwrite ? "overwrite with" : "merge"} ${entries.length} files → ${home}\n`
    );
    for (const e of entries) console.log(`  ${e.entryName}`);
    return;
  }

  if (overwrite) {
    zip.extractAllTo(home, true);
    logDebug("import", `done overwrote=${entries.length} to=${home}`);
    console.log(`Imported ${entries.length} files → ${home} (overwrite)`);
    appendImportLog(home, {
      ts: new Date().toISOString(),
      archive: zipPath,
      mode: "overwrite",
      created: 0,
      merged: 0,
      identical: 0,
      conflicts: 0,
      skipped: 0,
      linesAdded: 0,
      quarantineDir: null,
    });
    log.info("Run 'pal cli install' to re-register hooks.");
    return;
  }

  ensureRegistered(home);
  const quarantineDir = resolve(
    home,
    "backups",
    `import-conflicts-${new Date()
      .toISOString()
      .replace(/[-:T.]/g, "")
      .slice(0, 14)}`
  );
  const result = mergeArchive(
    entries.map((e) => ({ path: e.entryName, data: () => e.getData() })),
    home,
    quarantineDir
  );
  const source = readManifest(
    entries.map((e) => ({ path: e.entryName, data: () => e.getData() }))
  );
  if (source) {
    writeRegistryEntry({ id: source.machineId, label: source.label, os: source.os });
    console.log(`Source machine: ${source.label} (${source.machineId})`);
  }

  appendImportLog(home, {
    ts: new Date().toISOString(),
    archive: zipPath,
    mode: "merge",
    created: result.created.length,
    merged: result.merged.length,
    identical: result.identical.length,
    conflicts: result.conflicts.length,
    skipped: result.skipped.length,
    linesAdded: result.linesAdded,
    quarantineDir: result.quarantineDir,
    sourceMachineId: source?.machineId ?? null,
  });

  logDebug("import", `done merge ${summarize(result)} to=${home}`);
  console.log(`Imported → ${home}: ${summarize(result)}`);
  if (result.conflicts.length > 0) {
    log.warn(
      `${result.conflicts.length} file(s) diverged — local kept, incoming saved to ${result.quarantineDir}`
    );
    for (const c of result.conflicts) console.log(`  ${c}`);
  }
  log.info("Run 'pal cli install' to re-register hooks.");
}

async function update() {
  const { checkForUpdate, clearUpdateCache } = await import(
    "../hooks/handlers/update-check"
  );
  const result = await checkForUpdate(true);

  log.info(`Current: ${result.current} (${result.mode} mode)`);

  if (!result.available) {
    log.success("Already up to date.");
    return;
  }

  log.info(`Available: ${result.latest}`);

  const pkg = palPkg();
  if (result.mode === "repo") {
    log.info("Pulling updates...");
    const pull = spawnSync("git", ["pull", "--ff-only"], { cwd: pkg, stdio: "inherit" });
    if (pull.status !== 0) {
      log.error("git pull failed. You may have local changes — try pulling manually.");
      process.exit(1);
    }
  } else {
    log.info("Updating via bun...");
    const up = spawnSync("bun", ["add", "-g", `portable-agent-layer@${result.latest}`], {
      stdio: "inherit",
    });
    if (up.status !== 0) {
      log.error(`Update failed. Try: bun add -g portable-agent-layer@${result.latest}`);
      process.exit(1);
    }
  }

  let newPkg: { version: string };
  try {
    newPkg = JSON.parse(readFileSync(resolve(pkg, "package.json"), "utf-8")) as {
      version: string;
    };
  } catch (e) {
    throw new Error(`Failed to read updated package.json: ${e}`);
  }
  log.success(`Updated: ${result.current} → ${newPkg.version}`);
  clearUpdateCache();

  log.info("Reinstalling...");
  await install(resolveTargets([]));
}

function cliDebug(args: string[]) {
  const stateDir = resolve(palHome(), "memory", "state");
  const flagFile = resolve(stateDir, "debug-enabled");
  // Must match log.ts's logFile() — reporting a different path sends anyone
  // debugging a hook to an empty file.
  const logFile = resolve(paths.debug(), "debug.log");
  const sub = args[0];
  if (sub === "on") {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(flagFile, "");
    log.success(`Debug logging enabled → ${logFile}`);
  } else if (sub === "off") {
    rmSync(flagFile, { force: true });
    log.success("Debug logging disabled");
  } else {
    const on = existsSync(flagFile);
    console.log(`  Debug: ${on ? "ON" : "OFF"}`);
    console.log(`  Log:   ${logFile}`);
  }
}

async function status() {
  const home = palHome();
  const pkg = palPkg();

  let pkgJson: { version: string };
  try {
    pkgJson = JSON.parse(readFileSync(resolve(pkg, "package.json"), "utf-8")) as {
      version: string;
    };
  } catch (e) {
    throw new Error(`Failed to read package.json: ${e}`);
  }

  console.log("");
  log.info(`Version:  ${pkgJson.version}`);
  log.info(`Package:  ${pkg}`);
  log.info(`Home:     ${home}`);
  console.log("");

  log.info(`Claude:   ${platform.claudeDir()}`);
  log.info(`opencode: ${platform.opencodeDir()}`);
  log.info(`Cursor:   ${platform.cursorDir()}`);
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

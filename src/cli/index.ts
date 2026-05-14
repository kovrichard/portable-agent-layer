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
 *   import [path] [--dry-run]         Import user state from zip
 *   status                            Show current PAL configuration
 *   doctor                            Check prerequisites and system health
 *   usage                             Summarize token usage and cost
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { palHome, palPkg, platform } from "../hooks/lib/paths";
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
    case "doctor":
      doctor();
      break;
    case "migrate": {
      const { runMigrate } = await import("./migrate");
      runMigrate(args);
      break;
    }
    case "usage": {
      const { usage } = await import("../tools/token-cost");
      usage();
      break;
    }
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
    pal cli import [path] [--dry-run]       Import state from zip
    pal cli status                          Show PAL configuration
    pal cli doctor                          Check prerequisites and health
    pal cli migrate [--list] [--dry-run]    Run pending data migrations
    pal cli usage                           Summarize token usage and cost

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
  cursor: ToolCheck;
  copilot: ToolCheck;
  codex: ToolCheck;
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
      hasAgent: true,
    };
  }

  const bun = { name: "bun", available: true, version: Bun.version };
  const claude = checkTool("claude");
  const opencode = checkTool("opencode");
  const cursor = checkTool("cursor");
  const copilot = checkTool("copilot", ["version"]);
  const codex = checkTool("codex");
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

    console.log("");
    log.info("Doctor");
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

    // Skills (per installed agent)
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

    // Dependencies
    const nodeModulesPath = resolve(palPkg(), "node_modules");
    existsSync(nodeModulesPath)
      ? ok("Dependencies installed")
      : fail("Dependencies missing — run 'pal cli install'");

    // Playwright Chromium (required by create-pdf + consulting-report skills)
    checkPlaywrightChromium()
      ? ok("Playwright Chromium installed")
      : fail(
          "Playwright Chromium — not found (run 'pal cli install' or 'bunx playwright install chromium')"
        );

    // Hook registration (per installed agent)
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

    // API key checks
    process.env.PAL_ANTHROPIC_API_KEY
      ? ok("PAL_ANTHROPIC_API_KEY is set")
      : fail("PAL_ANTHROPIC_API_KEY — not set (hooks need it for inference)");
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

  return { bun, claude, opencode, cursor, copilot, codex, hasAgent };
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

  scaffoldTelos();

  // Auto-detect available targets
  const targets = resolveTargets(args, health);
  await install(targets);
}

async function install(targets: Targets) {
  // Ensure dependencies are installed
  const pkg = palPkg();
  log.info("Installing dependencies...");
  const deps = spawnSync("bun", ["install", "--frozen-lockfile"], {
    cwd: pkg,
    stdio: "inherit",
    shell: true,
  });
  if (deps.status !== 0) {
    log.warn("bun install failed — continuing anyway, but hooks may not work");
  }

  // Fetch the Chromium build Playwright uses for PDF rendering (create-pdf skill).
  // Idempotent — skipped if already cached. Skipped entirely under PAL_SKIP_BROWSER_INSTALL=1
  // (used by tests to avoid a ~150MB download on every run).
  // Uses `bun x` (not `bunx`) for Windows compatibility — bunx resolves unreliably under cmd.exe.
  if (process.env.PAL_SKIP_BROWSER_INSTALL !== "1") {
    log.info("Installing Playwright Chromium...");
    const pw = spawnSync("bun", ["x", "playwright", "install", "chromium"], {
      cwd: pkg,
      stdio: "inherit",
      shell: true,
    });
    if (pw.status !== 0) {
      log.warn(
        `playwright install chromium failed (exit ${pw.status}) — create-pdf and consulting-report skills won't work. Retry manually: bun x playwright install chromium`
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
  const { scaffoldTelos, scaffoldPalSettings } = await import("../targets/lib");
  const { promptIdentity } = await import("./setup-identity");
  const { promptTelos } = await import("./setup-telos");
  scaffoldTelos();
  scaffoldPalSettings();
  await promptIdentity();
  await promptTelos();

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

async function update() {
  const { checkForUpdate } = await import("../hooks/handlers/update-check");
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

  const newPkg = JSON.parse(readFileSync(resolve(pkg, "package.json"), "utf-8"));
  log.success(`Updated: ${result.current} → ${newPkg.version}`);

  log.info("Reinstalling...");
  await install(resolveTargets([]));
}

async function status() {
  const home = palHome();
  const pkg = palPkg();

  const pkgJson = JSON.parse(readFileSync(resolve(pkg, "package.json"), "utf-8"));

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

#!/usr/bin/env bun
/**
 * PAL CLI — Portable Agent Layer
 *
 * Usage:
 *   pal [agent-args...]               Start the first installed agent: claude, codex, cursor-agent, copilot, opencode
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
 *   ledger <sub> [filters]            Query the action ledger (log · show · stats)
 *   rule list|approve|deny [id]       Review rules drafted from your corrections
 *   server start|stop|restart|status  The control room, a local page over ~/.pal
 *   <tool> [args]                     Run a built-in agent tool (project, thread, analyze, …)
 *   skill run <skill> <tool> [-- args]  Run a skill's own tool by name, not by path
 *   skill link <name>                 Link a personal ~/.pal/skills/<name>/ into installed agents
 *   skill doctor <name|--all>         Evaluate one skill, or every installed skill, against the authoring best practices
 *   subagent link <name>             Install a personal ~/.pal/agents/<name>.md into installed agents
 *   subagent doctor <name>           Evaluate a subagent against the authoring best practices
 *   debug [on|off]                    Enable / disable verbose hook debug logging
 *   version | -v                      Print the installed PAL version
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
import { AGENT_NAMES, AGENT_REGISTRY, type AgentName } from "../hooks/lib/agent-registry";
import {
  appendImportLog,
  mergeArchive,
  readManifest,
  summarize,
} from "../hooks/lib/import-merge";
import { inference, previewInferenceRoute } from "../hooks/lib/inference";
import { logDebug } from "../hooks/lib/log";
import { ensureRegistered, writeRegistryEntry } from "../hooks/lib/machine";
import { palHome, palPkg, paths, platform, toPath } from "../hooks/lib/paths";
import { log, narrateSteps } from "../targets/lib";
import { builtinToolVerbs, runBuiltinTool } from "./builtin-tools";
import { type DoctorResult, detectAgents } from "./doctor/agents";
import { installChromium } from "./doctor/environment";
import { runDoctor } from "./doctor/run";
import { findSessionAgent, NO_SESSION_AGENT_MESSAGE } from "./session-agent";

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

async function session(sessionArgs: string[]) {
  const agent = findSessionAgent();
  if (!agent) {
    log.error(NO_SESSION_AGENT_MESSAGE);
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
    const { autoUpdateOnClose } = await import("../hooks/lib/auto-update");
    const closing = autoUpdateOnClose();
    if (closing) console.log(`\n${closing}`);
  } catch {
    // Non-critical
  }

  process.exit(exitCode);
}

// ── CLI dispatcher ──

async function runCli(command: string | undefined, args: string[]) {
  if (command && (await runBuiltinTool(command, args))) return;
  switch (command) {
    case "init":
      await init(args);
      break;
    case "install":
      banner();
      process.exit(await install(resolveTargets(args), args));
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
      const exitCode = runDoctor(args);
      if (args.includes("--probe-inference") || args.includes("--probe")) {
        await probeInference();
      }
      process.exit(exitCode);
      break;
    }
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
    case "knowledge": {
      const { runKnowledge } = await import("./knowledge");
      const code = await runKnowledge(args);
      if (code !== 0) process.exit(code);
      break;
    }
    case "ledger": {
      const { runLedger } = await import("./ledger");
      const code = await runLedger(args);
      if (code !== 0) process.exit(code);
      break;
    }
    case "rule": {
      const { runRule } = await import("./rule");
      const code = await runRule(args);
      if (code !== 0) process.exit(code);
      break;
    }
    case "server": {
      const { runServer } = await import("./server");
      const code = await runServer(args);
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
    case "telos": {
      const { runTelos } = await import("./personal-context");
      const code = runTelos(args);
      if (code !== 0) process.exit(code);
      break;
    }
    case "timezone": {
      const { runTimezone } = await import("./personal-context");
      const code = runTimezone(args);
      if (code !== 0) process.exit(code);
      break;
    }
    case "debug":
      cliDebug(args);
      break;
    case "version":
    case "-v":
    case "--version":
      showVersion();
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
  console.log("  ╚═══════════════════════════════════╝");
  console.log("");
}

function showHelp() {
  console.log(`
  Usage:
    pal [agent-args...]                     Start the first installed agent
    pal cli <command> [options]             Admin commands

  Admin commands:
    pal cli init [--claude] [--opencode] [--cursor] [--codex]    Scaffold and install (default: all), then run the doctor
    pal cli install [--claude] [--opencode] [--cursor] [--codex] Register hooks for targets, then run the doctor
                                            Add --verbose to either for the step-by-step log
    pal cli uninstall [--claude] [--opencode] [--cursor] [--codex] Remove hooks for targets
    pal cli update                          Update PAL (git pull or npm update)
    pal cli export [path] [--dry-run]       Export state to zip
    pal cli import [path] [--dry-run]       Merge state from zip (--overwrite to replace)
    pal cli status                          Show PAL configuration
    pal cli doctor [--verbose] [--json]     Find what is wrong and how to fix it; exits 1 on any failure
                   [--probe-inference]      Also fire real inference per route
    pal cli migrate [--list] [--dry-run]    Run pending data migrations
    pal cli <tool> [args]                   Run a built-in agent tool ('<tool> --help' for its flags):
                                            ${builtinToolVerbs.join(" · ")}
    pal cli usage                           Summarize token usage and cost
    pal cli actor [label <name>]            Show or rename this actor (who caused a record)
    pal cli machine [label <name>]          Show or rename this install (where it was written)
    pal cli telos                           Which TELOS topics are answered, in interview order
    pal cli timezone [<zone>]               Show or set your timezone (IANA name)
    pal cli knowledge <sub> [args]          Query & manage the knowledge store
                                            (search · graph · stats · hubs · find · show · add · ls)
    pal cli ledger <sub> [filters]          Query the action ledger (log · show · stats)
                                            e.g. ledger log --project X --since 7d
    pal cli rule list|approve|deny [id]     Review rules drafted from your corrections
    pal cli server start|stop|restart|status  The control room: a local page to open before a terminal
    pal cli skill run <skill> <tool> [-- args]  Run ~/.pal/skills/<skill>/tools/<tool> by name
    pal cli skill link <name>               Link a personal ~/.pal/skills/<name>/ into installed agents
    pal cli skill doctor <name|--all>       Evaluate one skill, or every installed skill
    pal cli skill author-model              Print the flagship model that authors skills for the active agent
    pal cli subagent link <name>            Install a personal ~/.pal/agents/<name>.md into installed agents
    pal cli subagent doctor <name>          Evaluate a subagent against the authoring best practices
    pal cli subagent list                   List the user-authored subagents in ~/.pal/agents/
    pal cli subagent author-model           Print the flagship model that authors subagents for the active agent
    pal cli debug [on|off]                  Enable/disable verbose hook debug logging (persisted)
    pal cli version | -v                    Print the installed PAL version

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

type Targets = Record<AgentName, boolean>;

function targetsWhere(selected: (agent: AgentName) => boolean): Targets {
  return Object.fromEntries(
    AGENT_NAMES.map((agent) => [agent, selected(agent)])
  ) as Targets;
}

function namedTargets(args: string[]): AgentName[] {
  if (args.includes("--all")) return AGENT_NAMES;
  return AGENT_NAMES.filter((agent) => args.includes(`--${agent}`));
}

function parseTargets(args: string[]): Targets {
  const named = namedTargets(args);
  return named.length === 0
    ? targetsWhere(() => true)
    : targetsWhere((a) => named.includes(a));
}

/** Resolve targets against available agents. Errors if explicitly requested but missing. */
function resolveTargets(args: string[], health?: DoctorResult): Targets {
  const requested = parseTargets(args);
  const h = health || detectAgents();

  if (namedTargets(args).length > 0) {
    const missing = AGENT_NAMES.find((agent) => requested[agent] && !h[agent].available);
    if (missing) {
      log.error(
        `${AGENT_REGISTRY[missing].label} is not installed. Run 'pal cli doctor' for details.`
      );
      process.exit(1);
    }
    return requested;
  }

  const targets = targetsWhere((agent) => h[agent].available);
  for (const agent of AGENT_NAMES) {
    if (!targets[agent])
      log.info(`Skipping ${AGENT_REGISTRY[agent].label} (not installed)`);
  }
  return targets;
}

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
          `  ${red}✗${reset} ${tag} ${String(elapsedMs).padStart(6)}ms  ${dim}${r.error ?? "failed — see ~/.pal/debug/debug.log"}${reset}`
        );
      }
    }
  } finally {
    if (savedAgent === undefined) delete process.env.PAL_AGENT;
    else process.env.PAL_AGENT = savedAgent;
  }
}

// ── Commands ──

async function init(args: string[]) {
  const { scaffoldTelos } = await import("../targets/lib");

  banner();
  narrateSteps(args.includes("--verbose"));

  const health = detectAgents();
  if (!health.hasAgent) process.exit(runDoctor([], health));

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
  process.exit(await install(targets, args));
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

function targetScripts(): Record<
  AgentName,
  { install: () => Promise<unknown>; uninstall: () => Promise<unknown> }
> {
  return {
    claude: {
      install: () => import("../targets/claude/install"),
      uninstall: () => import("../targets/claude/uninstall"),
    },
    opencode: {
      install: () => import("../targets/opencode/install"),
      uninstall: () => import("../targets/opencode/uninstall"),
    },
    cursor: {
      install: () => import("../targets/cursor/install"),
      uninstall: () => import("../targets/cursor/uninstall"),
    },
    copilot: {
      install: () => import("../targets/copilot/install"),
      uninstall: () => import("../targets/copilot/uninstall"),
    },
    codex: {
      install: () => import("../targets/codex/install"),
      uninstall: () => import("../targets/codex/uninstall"),
    },
  };
}

function targetInstallers(): [AgentName, string, () => Promise<unknown>][] {
  return AGENT_NAMES.map((agent) => [
    agent,
    AGENT_REGISTRY[agent].label,
    targetScripts()[agent].install,
  ]);
}

async function install(targets: Targets, args: string[]): Promise<number> {
  narrateSteps(args.includes("--verbose"));
  const pkg = palPkg();
  const { dependencyInstall } = await import("./dependencies");
  const { isRepoMode } = await import("../hooks/handlers/update-check");
  const bunInstall = dependencyInstall(pkg, isRepoMode());
  if (bunInstall && runQuietly("bun", bunInstall, pkg) !== 0) {
    log.warn("bun install failed — continuing anyway, but hooks may not work");
  }

  const { applyPendingMigrations } = await import("./migrate");
  for (const line of applyPendingMigrations()) log.info(line);

  // Uses `bun x` (not `bunx`) for Windows compatibility — bunx resolves unreliably under cmd.exe.
  if (process.env.PAL_SKIP_BROWSER_INSTALL !== "1") installChromium();

  // Scaffold TELOS + PAL settings, then prompt for missing identity
  const { scaffoldTelos, scaffoldPalSettings, copyPalDocs, generateSkillIndex } =
    await import("../targets/lib");
  const { promptIdentity } = await import("./setup-identity");
  const { promptAttribution } = await import("./setup-attribution");
  const { promptAutoUpdate } = await import("./setup-auto-update");
  scaffoldTelos();
  scaffoldPalSettings();
  await promptIdentity();
  await promptAttribution();
  await promptAutoUpdate();

  // Registers the label loadActor derives, so it travels on the next export.
  const { ensureActorRegistered } = await import("../hooks/lib/actor");
  ensureActorRegistered();

  // Shared, target-independent state. Every target installer used to repeat these
  // identical calls; AGENTS.md in particular must exist before any target symlinks
  // to it, so it runs once here rather than once per target.
  const { regenerateIfNeeded } = await import("../hooks/lib/claude-md");
  const palDocsCount = copyPalDocs();
  regenerateIfNeeded();

  for (const [target, label, installTarget] of targetInstallers()) {
    if (!targets[target]) continue;
    log.heading(label);
    await installTarget();
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

  await refreshControlRoom();

  if (args.includes("--verbose")) console.log("");
  return runDoctor(args);
}

/**
 * A published install carries the page in its tarball; a checkout does not —
 * ui/dist is gitignored, so a pull leaves whatever was built last. Rebuild
 * there, then replace the process, because the API is the running code.
 */
async function refreshControlRoom(): Promise<void> {
  const { isRepoMode } = await import("../hooks/handlers/update-check");
  const { buildPage } = await import("../tools/control-room/static");
  if (isRepoMode() && !buildPage()) {
    log.warn("Control room page could not be rebuilt — run: bun run build:ui");
    return;
  }

  const { restartIfRunning } = await import("./server");
  if (await restartIfRunning()) log.success("Control room restarted on the new build");
}

async function uninstall(args: string[]) {
  const targets = parseTargets(args);

  for (const agent of AGENT_NAMES.filter((a) => targets[a])) {
    console.log(`━━━ ${AGENT_REGISTRY[agent].label} ━━━`);
    await targetScripts()[agent].uninstall();
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
  const resolvedArg = pathArg ? toPath(pathArg) : null;
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

  const resolvedArg = pathArg ? toPath(pathArg) : null;
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
  const { reinstallInFreshProcess } = await import("./reinstall");
  process.exit(reinstallInFreshProcess());
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

function packageVersion(): string {
  try {
    const pkgJson = JSON.parse(
      readFileSync(resolve(palPkg(), "package.json"), "utf-8")
    ) as {
      version: string;
    };
    return pkgJson.version;
  } catch (e) {
    throw new Error(`Failed to read package.json: ${e}`);
  }
}

function showVersion() {
  console.log(packageVersion());
}

async function status() {
  const home = palHome();
  const pkg = palPkg();

  console.log("");
  log.info(`Version:  ${packageVersion()}`);
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

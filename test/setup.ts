/**
 * Bun test preload — runs before every test file.
 *
 * Disables real inference globally so no test can accidentally spawn `claude
 * --print` or hit the Anthropic API. Tests that intentionally exercise the
 * inference dispatcher (e.g. via a fake binary on PATH) opt back in by
 * deleting this env var in their own beforeEach.
 */
import { beforeEach } from "bun:test";
import { TEST_ROOT } from "./lib/test-home";

process.env.PAL_INFERENCE_DISABLED = "1";
process.env.PAL_NOTIFICATIONS_DISABLED = "1";

// Marks every test process (and the CLIs they spawn, which inherit the
// environment) as sandboxed. Installer code refuses to write links into the
// developer's real ~/.claude, ~/.codex, ~/.copilot and friends while this is
// set, so a test that forgets to override the PAL_*_DIR vars fails loudly
// instead of quietly rewiring the machine it runs on.
process.env.PAL_TEST_SANDBOX = "1";

// `git rev-parse --local-env-vars`: git exports GIT_DIR to hooks run from a linked worktree.
const gitRepositoryEnvVars = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

function detachFromHookRepository() {
  for (const name of gitRepositoryEnvVars) delete process.env[name];
}

detachFromHookRepository();

function stopGitAtTestHomes() {
  process.env.GIT_CEILING_DIRECTORIES = TEST_ROOT;
}

stopGitAtTestHomes();

function seeTheTerminalCiSees() {
  process.stdout.isTTY = false;
  delete process.env.FORCE_COLOR;
}

seeTheTerminalCiSees();

function startEveryTestOnTheOriginalPath() {
  const originalPath = process.env.PATH;
  beforeEach(() => {
    process.env.PATH = originalPath;
  });
}

startEveryTestOnTheOriginalPath();

function logSlowSpawns() {
  const childProcess = require("node:child_process");
  const label = (cmd: unknown, args: unknown) =>
    [cmd, ...(Array.isArray(args) ? args : [])].join(" ").slice(0, 160);
  const report = (what: string, started: number, extra: string) => {
    const ms = Math.round(performance.now() - started);
    if (ms > 1000) process.stderr.write(`SLOWSPAWN ${ms}ms ${what} ${extra}\n`);
  };
  const nodeSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = (cmd: unknown, args: unknown, opts: unknown) => {
    const started = performance.now();
    const result = nodeSpawnSync(cmd, args, opts);
    report(label(cmd, args), started, `status=${result.status} signal=${result.signal}`);
    return result;
  };
  const bunSpawnSync = Bun.spawnSync;
  Bun.spawnSync = ((cmd: unknown, opts: unknown) => {
    const started = performance.now();
    const result = bunSpawnSync(cmd as never, opts as never);
    const argv = Array.isArray(cmd) ? cmd : (cmd as { cmd: string[] }).cmd;
    report(label(argv[0], argv.slice(1)), started, `exit=${result.exitCode}`);
    return result;
  }) as typeof Bun.spawnSync;
}

logSlowSpawns();

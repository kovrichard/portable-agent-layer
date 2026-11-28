/**
 * Bun test preload — runs before every test file.
 *
 * Disables real inference globally so no test can accidentally spawn `claude
 * --print` or hit the Anthropic API. Tests that intentionally exercise the
 * inference dispatcher (e.g. via a fake binary on PATH) opt back in by
 * deleting this env var in their own beforeEach.
 */

import { afterAll, beforeEach, mock } from "bun:test";
import { mkdirSync } from "node:fs";
import * as os from "node:os";
import { resolve } from "node:path";
import { guardFile, sharedRepoConfig } from "./lib/repo-config-tripwire";
import { refuseSubprocessesOutsideSpawnFiles } from "./lib/subprocess-guard";
import {
  redirectTempIntoTestFolder,
  removeTestTempFolder,
  TEST_ROOT,
} from "./lib/test-home";

process.env.PAL_INFERENCE_DISABLED = "1";
process.env.PAL_NOTIFICATIONS_DISABLED = "1";
process.env.HUSKY = "0";
// 2026-11-10: fake CLIs abort on purpose; the real 0.5-1.5 s retry wait cost each dispatch test ~1.5 s
process.env.PAL_INFERENCE_RETRY_JITTER_MS = "0";

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

function loadPluginModulesFromTheCheckoutUnderTest() {
  delete process.env.PAL_DIR;
}

loadPluginModulesFromTheCheckoutUnderTest();

function keepTestsOutOfTheRealHome(): string {
  const home = resolve(TEST_ROOT, "user-home");
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  return home;
}

/**
 * Bun's homedir() ignores HOME, so without this `resolve(homedir(), ".pal")` is the user's real PAL home.
 * A module keeps the homedir it loaded with, so this runs before anything under src/ is imported.
 */
function makeTheRealHomeUnreachable(home: string) {
  const withTestHome = () => ({
    ...os,
    default: { ...os, homedir: () => home },
    homedir: () => home,
  });
  mock.module("node:os", withTestHome);
  mock.module("os", withTestHome);
}

/** The developer's shell may export PAL_CLAUDE_DIR and friends; spawned CLIs get no mock, only the environment. */
async function pointAgentDirsAtTheTestHome() {
  const { agentDirOverrides } = await import("../src/core/paths");

  for (const { env, realDir } of agentDirOverrides()) process.env[env] = realDir;
}

makeTheRealHomeUnreachable(keepTestsOutOfTheRealHome());
await pointAgentDirsAtTheTestHome();

function stopGitAtTestHomes() {
  process.env.GIT_CEILING_DIRECTORIES = TEST_ROOT;
}

stopGitAtTestHomes();

/** A commit, fetch or push otherwise starts `git maintenance run --auto`: a tenth of a dark-factory test's processes. */
function skipGitHousekeeping() {
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "maintenance.auto";
  process.env.GIT_CONFIG_VALUE_0 = "false";
}

skipGitHousekeeping();

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

function failTheTestAfterOneThatRewritesTheRealRepoConfig() {
  const config = sharedRepoConfig(import.meta.dir);
  if (!config) return;
  const changed = guardFile(config);
  beforeEach(() => {
    const problem = changed();
    if (problem) throw new Error(problem);
  });
}

failTheTestAfterOneThatRewritesTheRealRepoConfig();

function keepTempFilesInAFolderTheRunRemoves() {
  redirectTempIntoTestFolder();
  afterAll(removeTestTempFolder, 120_000);
}

keepTempFilesInAFolderTheRunRemoves();

refuseSubprocessesOutsideSpawnFiles();

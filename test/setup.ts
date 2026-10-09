/**
 * Bun test preload — runs before every test file.
 *
 * Disables real inference globally so no test can accidentally spawn `claude
 * --print` or hit the Anthropic API. Tests that intentionally exercise the
 * inference dispatcher (e.g. via a fake binary on PATH) opt back in by
 * deleting this env var in their own beforeEach.
 */
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

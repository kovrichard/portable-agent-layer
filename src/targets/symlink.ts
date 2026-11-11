import { lstatSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { agentDirOverrides } from "../hooks/lib/paths";

/**
 * The agent config trees PAL writes into when no env override is set. These are
 * the developer's own installed agents, so a test that forgets to point the
 * PAL_*_DIR vars at a sandbox silently rewires their real setup.
 */
function realAgentRoots(): string[] {
  return [
    resolve(homedir(), ".pal"),
    ...agentDirOverrides().map(({ realDir }) => realDir),
  ];
}

/**
 * Under `bun test` (PAL_TEST_SANDBOX, set by the test preload and inherited by
 * spawned CLIs), refuse any link that would land in a real agent tree. Tests
 * sandbox PAL_HOME far more reliably than they sandbox the per-agent dirs, and
 * the failure is otherwise invisible: the suite passes while the developer's
 * own agents accumulate links into a deleted test directory.
 */
function assertInsideTestSandbox(link: string): void {
  if (!process.env.PAL_TEST_SANDBOX) return;
  const escaped = realAgentRoots().find(
    (root) => link === root || link.startsWith(root + sep)
  );
  if (!escaped) return;
  throw new Error(
    `Refusing to write ${link}: outside the test sandbox (${escaped} is a real agent directory). ` +
      `Point ${agentDirOverrides()
        .map(({ env }) => env)
        .join(", ")} at a temp directory in this test.`
  );
}

/** Create or update a symlink/junction, replacing any non-symlink entry. */
export function ensureSymlink(
  link: string,
  target: string,
  type: "dir" | "junction"
): void {
  assertInsideTestSandbox(link);
  try {
    const st = lstatSync(link);
    if (st.isSymbolicLink()) return; // already a symlink, leave it
    rmSync(link, { recursive: true, force: true });
  } catch {
    // doesn't exist or broken — clean up just in case
    try {
      rmSync(link, { recursive: true, force: true });
    } catch {
      /* gone */
    }
  }
  symlinkSync(target, link, type);
}

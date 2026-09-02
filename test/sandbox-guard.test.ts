import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const ROOT = resolve(import.meta.dir, "../.test-home-sandbox-guard");

/**
 * A stand-in for the developer's home directory. `os.homedir()` reads HOME on
 * POSIX and USERPROFILE on Windows, so pointing both here means the guard's
 * "real agent directories" resolve inside the fixture. If the guard ever breaks,
 * the leak lands in this throwaway tree instead of the machine running the
 * suite — the failure this test exists to catch must not itself cause it.
 */
const FAKE_HOME = resolve(ROOT, "home");
const PAL_HOME = resolve(ROOT, "pal");
const AGENT_DIRS = [".claude", ".cursor", ".copilot", ".codex", ".agents"];

/** Link a skill the way a test that sandboxes PAL_HOME but forgets the agent dirs would. */
function linkWithUnsandboxedAgentDirs() {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: FAKE_HOME,
    USERPROFILE: FAKE_HOME,
    PAL_HOME,
  };
  for (const v of [
    "PAL_CLAUDE_DIR",
    "PAL_CURSOR_DIR",
    "PAL_COPILOT_DIR",
    "PAL_CODEX_DIR",
    "PAL_OPENCODE_DIR",
    "PAL_AGENTS_DIR",
  ]) {
    delete env[v];
  }
  return spawnSync("bun", ["run", CLI, "cli", "skill", "link", "guard-probe"], {
    env,
    encoding: "utf-8",
    timeout: 20000,
  });
}

beforeAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
  // The agent dirs must exist, or linkPersonalSkill treats them as "not installed".
  for (const dir of AGENT_DIRS) {
    mkdirSync(resolve(FAKE_HOME, dir, "skills"), { recursive: true });
  }
  mkdirSync(resolve(PAL_HOME, "skills", "guard-probe"), { recursive: true });
  writeFileSync(
    resolve(PAL_HOME, "skills", "guard-probe", "SKILL.md"),
    "---\nname: guard-probe\n---\n"
  );
});

afterAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
});

describe("test sandbox guard", () => {
  test("refuses to link into a real agent tree when a test forgets to sandbox", () => {
    const res = linkWithUnsandboxedAgentDirs();
    const output = res.stdout + res.stderr;

    // The write is refused, and the reason names the offending directory.
    expect(output).toContain("outside the test sandbox");
    expect(res.status).not.toBe(0);

    // Nothing was written into any of the agent trees under the stand-in home.
    for (const dir of AGENT_DIRS) {
      expect(existsSync(resolve(FAKE_HOME, dir, "skills", "guard-probe"))).toBe(false);
    }
  }, 25000);
});

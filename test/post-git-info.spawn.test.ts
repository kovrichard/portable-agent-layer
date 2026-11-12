import { beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const HOOK = resolve(import.meta.dir, "../src/hooks/PostGitInfo.ts");
let ROOT: string;

beforeEach(() => {
  ROOT = realpathSync(freshTestDir(import.meta.file));
  mkdirSync(resolve(ROOT, "pal", "memory"), { recursive: true });
});

function git(dir: string, ...args: string[]): void {
  const identity = [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "-c",
    "init.defaultBranch=main",
  ];
  const result = spawnSync("git", [...identity, ...args], {
    cwd: dir,
    encoding: "utf-8",
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

async function runHook(payload: unknown): Promise<string> {
  const proc = Bun.spawn(["bun", "run", HOOK, "--agent=claude"], {
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
    env: { ...process.env, PAL_HOME: resolve(ROOT, "pal"), PAL_AGENT: "claude" },
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

test("after a partial commit the hook shows what HEAD holds and what was left out", async () => {
  const dir = resolve(ROOT, "app");
  mkdirSync(dir);
  git(dir, "init", "-q");
  writeFileSync(resolve(dir, "kept.ts"), "kept");
  writeFileSync(resolve(dir, "left.ts"), "left");
  git(dir, "add", "kept.ts");
  git(dir, "commit", "-qm", "feat: kept");

  const out = await runHook({
    tool_name: "Bash",
    tool_input: { command: "git add kept.ts && git commit -m 'feat: kept'" },
    cwd: dir,
    duration_ms: 5000,
  });

  const context = JSON.parse(out).hookSpecificOutput.additionalContext;
  expect(context).toContain("Repo: app on main · 1 file uncommitted · never pushed");
  expect(context).toContain("left.ts (untracked)");
  expect(context).toMatch(/HEAD [0-9a-f]+ "feat: kept" contains 1 file: A kept\.ts/);
});

test("a command without git gets no output", async () => {
  expect(
    await runHook({ tool_name: "Bash", tool_input: { command: "ls" }, cwd: ROOT })
  ).toBe("");
});

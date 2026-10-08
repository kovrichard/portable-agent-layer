import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

type HookFormat = "claude" | "cursor" | "opencode" | "codex" | "antigravity";

const FORMAT_FLAGS = ["--codex", "--cursor", "--opencode", "--antigravity"];

export function hookFormatFromArgs(args: string[] = process.argv.slice(2)): HookFormat {
  const flag = FORMAT_FLAGS.find((f) => args.includes(f));
  return flag ? (flag.slice(2) as HookFormat) : "claude";
}

function withoutFormatFlags(args: string[]): string[] {
  return args.filter((arg) => !FORMAT_FLAGS.includes(arg));
}

/** agy starts a hook in the folder holding its hooks.json, `<workspace>/.agents`. */
function workspaceDir(format: HookFormat): string {
  return format === "antigravity" ? resolve("..") : process.cwd();
}

function writeFailure(format: HookFormat, output: string): number {
  if (format === "antigravity") {
    process.stdout.write(JSON.stringify({ decision: "continue", reason: output }));
    return 0;
  }
  process.stderr.write(output);
  return 2;
}

function writeSuccess(format: HookFormat, output: string): number {
  if (format === "codex" || format === "antigravity") return 0;
  process.stdout.write(JSON.stringify({ output }));
  return 0;
}

// Fails closed: a non-zero git status (not a repo, git missing, index locked)
// reports changes so the gates still run. Only a confirmed-empty status skips.
// --porcelain=v1 lists untracked files too, so a new file counts as a change.
function worktreeHasChanges(cwd: string): boolean {
  const r = spawnSync("git status --porcelain=v1", {
    cwd,
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if ((r.status ?? -1) !== 0) return true;
  return (r.stdout ?? "").trim().length > 0;
}

// Helper for agent hook scripts. Each hook file (lint.ts, test.ts, ...) is a
// thin wrapper that calls runHook(["bun", "run", "<script>"]). We capture
// stdout+stderr, return them on success in a JSON envelope (so Claude/opencode
// can show "(no output)" cleanly), and exit with code 2 on failure so the agent
// treats the hook as blocking. Codex expects a different protocol: no stdout on
// success, and a continuation prompt written to stderr on failure. Antigravity
// reads any stdout as a JSON reply, so it gets none on success and a Stop
// `continue` on failure, with exit 0.
export function runHook(args: string[], format = hookFormatFromArgs()): number {
  if (args.length === 0) {
    return writeFailure(format, "run-hook: no command provided");
  }
  const cwd = workspaceDir(format);
  if (!worktreeHasChanges(cwd)) {
    return writeSuccess(
      format,
      "skipped: worktree clean, HEAD already gated by pre-commit and CI"
    );
  }
  const command = args.join(" ");
  const r = spawnSync(command, {
    cwd,
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = [r.stdout, r.stderr].filter(Boolean).join("\n").trim();
  const output = out || "(no output)";
  const ok = (r.status ?? -1) === 0;

  if (ok) return writeSuccess(format, "ok");
  return writeFailure(format, output);
}

if (import.meta.main) {
  const exitCode = runHook(withoutFormatFlags(process.argv.slice(2)));
  process.exit(exitCode);
}

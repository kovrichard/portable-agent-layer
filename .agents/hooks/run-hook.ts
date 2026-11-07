import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type HookFormat = "claude" | "cursor" | "opencode" | "codex" | "antigravity";

const FORMAT_FLAGS = ["--codex", "--cursor", "--opencode", "--antigravity"];

export function hookFormatFromArgs(args: string[] = process.argv.slice(2)): HookFormat {
  const flag = FORMAT_FLAGS.find((f) => args.includes(f));
  return flag ? (flag.slice(2) as HookFormat) : "claude";
}

const SUBAGENT_FLAG = "--subagent";
const NEEDS_CODE_FLAG = "--needs-code";
const HOOK_FLAGS = [...FORMAT_FLAGS, SUBAGENT_FLAG, NEEDS_CODE_FLAG];

function withoutFormatFlags(args: string[]): string[] {
  return args.filter((arg) => !HOOK_FLAGS.includes(arg));
}

const FACTORY_ROLES_THAT_WRITE = ["test-writer", "code-writer", "debugger"];

type HookInput = {
  tool_name?: unknown;
  tool_input?: { done?: unknown; question?: unknown };
};

function asksAQuestion(result: { question?: unknown }): boolean {
  return typeof result.question === "string" && result.question.trim() !== "";
}

/** A factory role hands its result back through StructuredOutput; only a finished code-writing role is gated. */
export function factoryHandbackSkip(
  input: HookInput,
  role: string | undefined,
  needsCode: boolean
): string | null {
  if (input.tool_name !== "StructuredOutput") return null;
  if (!role || !FACTORY_ROLES_THAT_WRITE.includes(role))
    return "skipped: not the handback of a factory role that writes files";
  const result = input.tool_input ?? {};
  if (result.done !== true) return "skipped: the role is not done, so the build decides";
  if (asksAQuestion(result)) return "skipped: the role asks the PO a question";
  if (role === "test-writer" && needsCode)
    return "skipped: the test writer's tests come before the code this gate checks";
  return null;
}

function parseHookInput(text: string): HookInput {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let cachedHookInput: HookInput | undefined;

function hookInput(): HookInput {
  if (cachedHookInput) return cachedHookInput;
  if (process.stdin.isTTY) return {};
  try {
    cachedHookInput = parseHookInput(readFileSync(0, "utf8"));
  } catch {
    cachedHookInput = {};
  }
  return cachedHookInput;
}

function handbackSkipFromProcess(): string | null {
  return factoryHandbackSkip(
    hookInput(),
    process.env.DARK_FACTORY_ROLE,
    process.argv.includes(NEEDS_CODE_FLAG)
  );
}

function gitPath(cwd: string, flag: string): string | null {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", flag], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Fails closed: anything git cannot answer counts as a worktree of its own, so the gates run. */
function sharesMainCheckout(cwd: string): boolean {
  const gitDir = gitPath(cwd, "--git-dir");
  return gitDir !== null && gitDir === gitPath(cwd, "--git-common-dir");
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
export function runHook(
  args: string[],
  format = hookFormatFromArgs(),
  subagent = process.argv.includes(SUBAGENT_FLAG),
  handbackSkip = handbackSkipFromProcess()
): number {
  if (args.length === 0) {
    return writeFailure(format, "run-hook: no command provided");
  }
  if (handbackSkip) return writeSuccess(format, handbackSkip);
  const cwd = workspaceDir(format);
  if (subagent && sharesMainCheckout(cwd)) {
    return writeSuccess(
      format,
      "skipped: subagent shares the parent's checkout, which the parent's Stop gates"
    );
  }
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

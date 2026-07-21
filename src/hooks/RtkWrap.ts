/**
 * Hook: PreToolUse — transparently wraps Bash commands in `rtk` to compress
 * tool output before it reaches the model's context.
 *
 * PAL owns the wiring + presence-gating; rtk owns the rewrite. We do NOT
 * reimplement rtk's selectivity or per-agent JSON shape — we forward the hook's
 * stdin to `rtk hook <agent>` and pass its stdout straight back. rtk emits the
 * correct rewrite object for each agent (Claude/Cursor/Copilot all differ), or
 * nothing when a command isn't worth rewriting.
 *
 * Fail-open by construction: if rtk isn't installed, the agent can't rewrite,
 * or anything throws, we emit nothing and exit 0 — the original command runs
 * unchanged. rtk absent must never block or alter a Bash call.
 *
 * Codex (allow/deny only) and opencode (plugin path) have no `rtk hook`
 * subcommand and are handled elsewhere — this hook no-ops for them.
 */

import { getActiveAgent } from "./lib/agent";
import { findBinaryOnPath } from "./lib/which";

const RTK_HOOK_SUBCOMMAND: Partial<Record<ReturnType<typeof getActiveAgent>, string>> = {
  claude: "claude",
  cursor: "cursor",
  copilot: "copilot",
};

async function run(): Promise<void> {
  const subcommand = RTK_HOOK_SUBCOMMAND[getActiveAgent()];
  if (!subcommand) return; // codex/opencode — no rtk hook processor

  const rtk = findBinaryOnPath("rtk");
  if (!rtk) return; // fail-open: rtk not installed → command runs unchanged

  const stdin = await Bun.stdin.text();
  const proc = Bun.spawn([rtk, "hook", subcommand], {
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "ignore", // drop rtk's "no hook installed" stderr nag
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  if (proc.exitCode === 0 && out) {
    process.stdout.write(out);
  }
}

try {
  await run();
} catch {
  // Fail open — emit nothing, allow the original command.
}

interface ToolCall {
  tool_name?: string;
  tool_input?: { subagent_type?: string; isolation?: string; [field: string]: unknown };
}

const READ_ONLY_TYPES = ["Explore", "Plan", "claude-code-guide", "web-fetch"];

const isReadOnly = (type: string) =>
  READ_ONLY_TYPES.includes(type) || type.endsWith("-researcher");

/** Null lets the call through; a subagent sharing the checkout escapes the SubagentStop gates. */
export function isolationRefusal(call: ToolCall): string | null {
  if (call.tool_name !== "Agent") return null;
  const type = call.tool_input?.subagent_type ?? "general-purpose";
  if (isReadOnly(type) || call.tool_input?.isolation === "worktree") return null;
  return `A ${type} subagent can edit files, so launch it with isolation: "worktree". In this repo only read-only types (${READ_ONLY_TYPES.join(", ")}, *-researcher) share the checkout, because the repo gates check a subagent only in its own worktree.`;
}

if (import.meta.main) {
  const refusal = isolationRefusal(JSON.parse(await Bun.stdin.text()) as ToolCall);
  if (refusal) {
    process.stderr.write(refusal);
    process.exit(2);
  }
}

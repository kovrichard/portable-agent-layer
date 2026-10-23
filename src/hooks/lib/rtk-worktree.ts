const AGENT_WORKTREE = /[\\/]\.claude[\\/]worktrees[\\/]/;
const GIT_WORD = /(^|[^\w.-])git($|[^\w.-])/;

/**
 * Claude Code refuses a worktree-isolated agent any command that runs git behind
 * a launcher, because it cannot tell which checkout git would touch.
 */
export function isWorktreeAgentGitCall(hookInput: string): boolean {
  try {
    const { cwd, tool_input } = JSON.parse(hookInput) as {
      cwd?: string;
      tool_input?: { command?: string };
    };
    return AGENT_WORKTREE.test(cwd ?? "") && GIT_WORD.test(tool_input?.command ?? "");
  } catch {
    return false;
  }
}

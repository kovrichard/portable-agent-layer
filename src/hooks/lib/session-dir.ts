/**
 * The folder a session was started in. A hook's own cwd follows every `cd`
 * the agent makes, so keying by it files a session under whatever subfolder
 * it happened to end in. Claude Code exports the start folder as
 * CLAUDE_PROJECT_DIR; agents that do not fall back to the cwd.
 */
export function sessionDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_PROJECT_DIR || process.cwd();
}

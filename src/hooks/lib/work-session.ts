/**
 * Which session a piece of work-tree activity belongs to, so parallel sessions
 * in one project each keep their own active node. A hook knows its session
 * from the payload, but `pal cli work` runs in the agent's shell and knows it
 * only from what the agent exports there, so only agents that export it get
 * their own lane; the rest share one, as every session did before.
 */

import { type AgentType, getActiveAgent } from "./agent";

const SHELL_SESSION_ENV: Partial<Record<AgentType, string>> = {
  claude: "CLAUDE_CODE_SESSION_ID",
  codex: "CODEX_THREAD_ID",
  copilot: "COPILOT_AGENT_SESSION_ID",
  antigravity: "ANTIGRAVITY_CONVERSATION_ID",
  opencode: "PAL_OPENCODE_SESSION_ID",
  cursor: "CURSOR_CONVERSATION_ID",
};

export function workSession(
  hookSession?: string,
  env: NodeJS.ProcessEnv = process.env,
  agent: AgentType = getActiveAgent()
): string | undefined {
  const variable = SHELL_SESSION_ENV[agent];
  if (!variable) return undefined;
  return hookSession || env[variable] || undefined;
}

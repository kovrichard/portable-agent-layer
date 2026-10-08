import { AGENT_REGISTRY, LAUNCH_PRIORITY } from "../hooks/lib/agent-registry";
import { findBinaryOnPath } from "../hooks/lib/which";

export type SessionAgent =
  (typeof AGENT_REGISTRY)[(typeof LAUNCH_PRIORITY)[number]]["binary"];

const SESSION_AGENT_BINARIES: readonly SessionAgent[] = LAUNCH_PRIORITY.map(
  (agent) => AGENT_REGISTRY[agent].binary
);

export function findSessionAgent(): SessionAgent | null {
  return (
    SESSION_AGENT_BINARIES.find((binary) => findBinaryOnPath(binary) !== null) ?? null
  );
}

export const NO_SESSION_AGENT_MESSAGE =
  "No supported agent found. Install Claude Code, Codex, Cursor CLI, Copilot CLI, opencode or Antigravity CLI.";

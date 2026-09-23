import { findBinaryOnPath } from "../hooks/lib/which";

const SESSION_AGENT_BINARIES = [
  "claude",
  "codex",
  "cursor-agent",
  "copilot",
  "opencode",
] as const;

export type SessionAgent = (typeof SESSION_AGENT_BINARIES)[number];

export function findSessionAgent(): SessionAgent | null {
  return (
    SESSION_AGENT_BINARIES.find((binary) => findBinaryOnPath(binary) !== null) ?? null
  );
}

export const NO_SESSION_AGENT_MESSAGE =
  "No supported agent found. Install Claude Code, Codex, Cursor CLI, Copilot CLI or opencode.";

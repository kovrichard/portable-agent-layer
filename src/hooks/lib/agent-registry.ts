/**
 * The one list of agents PAL installs into. Every per-agent union, roster and
 * priority order elsewhere is derived from or checked against this table, so a
 * new agent starts here.
 */

import { resolve } from "node:path";
import { platform } from "./paths";

type SkillDiscovery = "own-skills-dir" | "shared-agents-skills";

interface AgentEntry {
  label: string;
  binary: string;
  home: () => string;
  skills: SkillDiscovery;
}

export const AGENT_REGISTRY = {
  claude: {
    label: "Claude Code",
    binary: "claude",
    home: platform.claudeDir,
    skills: "own-skills-dir",
  },
  opencode: {
    label: "opencode",
    binary: "opencode",
    home: platform.opencodeDir,
    skills: "shared-agents-skills",
  },
  cursor: {
    label: "Cursor",
    binary: "cursor-agent",
    home: platform.cursorDir,
    skills: "own-skills-dir",
  },
  copilot: {
    label: "Copilot",
    binary: "copilot",
    home: platform.copilotDir,
    skills: "own-skills-dir",
  },
  codex: {
    label: "Codex",
    binary: "codex",
    home: platform.codexDir,
    skills: "own-skills-dir",
  },
} as const satisfies Record<string, AgentEntry>;

export type AgentName = keyof typeof AGENT_REGISTRY;

export const AGENT_NAMES = Object.keys(AGENT_REGISTRY) as AgentName[];

export const INFERENCE_PRIORITY = [
  "claude",
  "codex",
  "opencode",
  "copilot",
  "cursor",
] as const satisfies readonly AgentName[];

export const LAUNCH_PRIORITY = [
  "claude",
  "codex",
  "cursor",
  "copilot",
  "opencode",
] as const satisfies readonly AgentName[];

export function skillsDirOf(agent: AgentName): string {
  const entry: AgentEntry = AGENT_REGISTRY[agent];
  const root = entry.skills === "own-skills-dir" ? entry.home() : platform.agentsDir();
  return resolve(root, "skills");
}

export function isAgentName(value: string): value is AgentName {
  return Object.hasOwn(AGENT_REGISTRY, value);
}

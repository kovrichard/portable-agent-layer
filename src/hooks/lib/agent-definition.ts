/**
 * The merged multi-platform subagent format shared by assets/agents/*.md and
 * ~/.pal/agents/*.md: global frontmatter lines, one indented block per platform,
 * and a body that becomes the subagent's system prompt.
 */

import { splitFrontmatter } from "./frontmatter";

export const AGENT_PLATFORMS = [
  "claude",
  "opencode",
  "cursor",
  "copilot",
  "codex",
] as const;
export type AgentPlatform = (typeof AGENT_PLATFORMS)[number];

export interface AgentDefinition {
  hasFrontmatter: boolean;
  global: string[];
  platforms: Partial<Record<AgentPlatform, string[]>>;
  body: string;
}

const PLATFORM_BLOCK_HEADER = new RegExp(
  String.raw`^(${AGENT_PLATFORMS.join("|")}):\s*$`
);
const BLOCK_INDENT = "  ";

export function parseAgentDefinition(content: string): AgentDefinition {
  const split = splitFrontmatter(content);
  if (!split) {
    return { hasFrontmatter: false, global: [], platforms: {}, body: content };
  }

  const global: string[] = [];
  const platforms: Partial<Record<AgentPlatform, string[]>> = {};
  let current: AgentPlatform | null = null;

  for (const line of split.frontmatter.split("\n")) {
    if (!line.trim()) continue;
    const header = PLATFORM_BLOCK_HEADER.exec(line);
    if (header) {
      current = header[1] as AgentPlatform;
      platforms[current] ??= [];
      continue;
    }
    if (current && line.startsWith(BLOCK_INDENT)) {
      platforms[current]?.push(line.slice(BLOCK_INDENT.length));
      continue;
    }
    current = null;
    global.push(line);
  }

  return { hasFrontmatter: true, global, platforms, body: split.body };
}

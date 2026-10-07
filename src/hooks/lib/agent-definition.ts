/**
 * The merged multi-platform subagent format shared by assets/agents/*.md and
 * ~/.pal/agents/*.md: global frontmatter lines, one indented block per platform,
 * and a body that becomes the subagent's system prompt.
 */

import { AGENT_NAMES, type AgentName } from "./agent-registry";
import { splitFrontmatter } from "./frontmatter";

export interface AgentDefinition {
  hasFrontmatter: boolean;
  global: string[];
  platforms: Partial<Record<AgentName, string[]>>;
  body: string;
}

const PLATFORM_BLOCK_HEADER = new RegExp(String.raw`^(${AGENT_NAMES.join("|")}):\s*$`);
const BLOCK_INDENT = "  ";

export function parseAgentDefinition(content: string): AgentDefinition {
  const split = splitFrontmatter(content);
  if (!split) {
    return { hasFrontmatter: false, global: [], platforms: {}, body: content };
  }

  const global: string[] = [];
  const platforms: Partial<Record<AgentName, string[]>> = {};
  let current: AgentName | null = null;

  for (const line of split.frontmatter.split("\n")) {
    if (!line.trim()) continue;
    const header = PLATFORM_BLOCK_HEADER.exec(line);
    if (header) {
      current = header[1] as AgentName;
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

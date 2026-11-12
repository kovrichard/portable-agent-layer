import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_NAMES, type AgentName } from "../hooks/lib/agent-registry";
import { palHome } from "../hooks/lib/paths";
import { agentFileName, renderAgentForPlatform } from "./agent-render";
import { nativeAgentsDir, shippedAgentNames } from "./shipped-agents";

/**
 * Store for user-authored subagents: ~/.pal/agents/<name>.md — one merged
 * multi-platform frontmatter file per subagent (same schema as assets/agents/).
 */
const palAgentsStore = () => resolve(palHome(), "agents");

/**
 * Each installed agent and the native agents directory a personal subagent is
 * written into. An agent counts as installed when its agents directory already
 * exists (mirrors linkPersonalSkill's per-agent gate).
 */
function personalSubagentTargets(): { agent: AgentName; dir: string }[] {
  return AGENT_NAMES.map((agent) => ({ agent, dir: nativeAgentsDir(agent) }));
}

/** List the user-authored subagents in ~/.pal/agents/. */
export function listPersonalSubagents(): string[] {
  if (!existsSync(palAgentsStore())) return [];
  return readdirSync(palAgentsStore())
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

/**
 * Install a personal subagent (~/.pal/agents/<name>.md) into every installed
 * agent by splitting its merged frontmatter per platform and writing the
 * result into that agent's native agents dir. Unlike personal skills (which are
 * symlinked), subagents are transformed-and-copied because each platform needs
 * its own frontmatter shape. Returns the agents it was installed into.
 */
export function installPersonalSubagent(name: string): string[] {
  const src = resolve(palAgentsStore(), `${name}.md`);
  if (!existsSync(src)) {
    throw new Error(`No subagent found at ${src}`);
  }
  if (shippedAgentNames().has(name)) {
    throw new Error(
      `'${name}' is a shipped PAL subagent — choose another name (a reinstall would overwrite it).`
    );
  }
  const content = readFileSync(src, "utf-8");
  const renders = personalSubagentTargets()
    .filter(({ dir }) => existsSync(dir))
    .map(({ agent, dir }) => ({
      agent,
      file: resolve(dir, agentFileName(name, agent)),
      text: renderForPersonalSubagent(content, agent),
    }));
  for (const { file, text } of renders) writeFileSync(file, text, "utf-8");
  return renders.map(({ agent }) => agent);
}

function renderForPersonalSubagent(content: string, agent: AgentName): string {
  try {
    return renderAgentForPlatform(content, agent);
  } catch (e) {
    throw new Error(`Cannot build the ${agent} subagent: ${(e as Error).message}`);
  }
}

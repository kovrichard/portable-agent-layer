import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { AGENT_REGISTRY, type AgentName } from "../hooks/lib/agent-registry";
import { assets } from "../hooks/lib/paths";
import { agentFileName, renderAgentForPlatform } from "./agent-render";
import { reportOnlyOnFailure } from "./bulk-install";
import { log } from "./log";

const shippedAgentStems = () =>
  readdirSync(assets.agents())
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));

const shippedAgentSource = (stem: string) =>
  readFileSync(resolve(assets.agents(), `${stem}.md`), "utf-8");

/** Install agents for a platform into a target directory. Always overwrites. */
export function installAgents(targetDir: string, platform: AgentName): number {
  if (!existsSync(assets.agents())) return 0;

  mkdirSync(targetDir, { recursive: true });
  let count = 0;

  for (const stem of shippedAgentStems()) {
    const installed = reportOnlyOnFailure(`${platform} agent ${stem}`, () => {
      writeFileSync(
        resolve(targetDir, agentFileName(stem, platform)),
        renderAgentForPlatform(shippedAgentSource(stem), platform),
        "utf-8"
      );
    });
    if (installed) count++;
  }

  return count;
}

/** Shipped agents in targetDir that differ from what installAgents would write there. */
export function staleShippedAgents(targetDir: string, agent: AgentName): string[] {
  if (!existsSync(assets.agents())) return [];
  const isStale = (stem: string) => {
    const installed = resolve(targetDir, agentFileName(stem, agent));

    return (
      !existsSync(installed) ||
      readFileSync(installed, "utf-8") !==
        renderAgentForPlatform(shippedAgentSource(stem), agent)
    );
  };

  return shippedAgentStems().filter(isStale).sort();
}

/** Remove PAL agents from a directory. */
function uninstallAgents(targetDir: string, platform: AgentName): string[] {
  if (!existsSync(assets.agents())) return [];

  const removed: string[] = [];

  for (const stem of shippedAgentStems()) {
    const dst = resolve(targetDir, agentFileName(stem, platform));
    if (existsSync(dst)) {
      unlinkSync(dst);
      removed.push(stem);
      log.detail(`Removed ${platform} agent: ${stem}`);
    }
  }

  return removed;
}

export function copyAgentsForOpencode(ocAgentsDir: string): number {
  return installAgents(ocAgentsDir, "opencode");
}

export function removeAgentsFromOpencode(ocAgentsDir: string): string[] {
  return uninstallAgents(ocAgentsDir, "opencode");
}

export function copyAgentsForCursor(cursorAgentsDir: string): number {
  return installAgents(cursorAgentsDir, "cursor");
}

export function copyAgentsForCopilot(copilotAgentsDir: string): number {
  return installAgents(copilotAgentsDir, "copilot");
}

export function copyAgentsForCodex(codexAgentsDir: string): number {
  return installAgents(codexAgentsDir, "codex");
}

export function copyAgentsForAntigravity(pluginAgentsDir: string): number {
  return installAgents(pluginAgentsDir, "antigravity");
}

export function removeAgentsFromCursor(cursorAgentsDir: string): string[] {
  return uninstallAgents(cursorAgentsDir, "cursor");
}

export function removeAgentsFromCopilot(copilotAgentsDir: string): string[] {
  return uninstallAgents(copilotAgentsDir, "copilot");
}

export function removeAgentsFromCodex(codexAgentsDir: string): string[] {
  return uninstallAgents(codexAgentsDir, "codex");
}

/** The directory each agent reads its subagent definitions from. */
export function nativeAgentsDir(agent: AgentName): string {
  return resolve(AGENT_REGISTRY[agent].home(), "agents");
}

/** Names of the subagents PAL ships (assets/agents/*.md). */
export function shippedAgentNames(): Set<string> {
  const dir = assets.agents();
  if (!existsSync(dir)) return new Set();

  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
  );
}

export function installedShippedAgentCount(agent: AgentName): number {
  const dir = nativeAgentsDir(agent);

  return [...shippedAgentNames()].filter((name) =>
    existsSync(resolve(dir, agentFileName(name, agent)))
  ).length;
}

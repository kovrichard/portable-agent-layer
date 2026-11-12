import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { assets } from "../../hooks/lib/paths";
import { log } from "../log";
import { installAgents, nativeAgentsDir } from "../shipped-agents";

const claudeAgentsDir = () => nativeAgentsDir("claude");

/**
 * Install PAL agent definitions into ~/.claude/agents/.
 * Always overwrites — engine-managed, not user-editable.
 */
export function copyAgents(): number {
  return installAgents(claudeAgentsDir(), "claude");
}

/** Remove PAL agents from ~/.claude/agents/ */
export function removeAgents(): string[] {
  const agentsDir = assets.agents();
  if (!existsSync(agentsDir)) return [];

  const removed: string[] = [];

  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const dst = resolve(claudeAgentsDir(), file);
    if (existsSync(dst)) {
      unlinkSync(dst);
      const name = file.replace(/\.md$/, "");
      removed.push(name);
      log.detail(`Removed agent: ${name}`);
    }
  }

  return removed;
}

/** Count agent .md files in ~/.claude/agents/ */
export function countAgents(): number {
  if (!existsSync(claudeAgentsDir())) return 0;

  try {
    return readdirSync(claudeAgentsDir()).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/** Count .md files in a directory */
export function countMd(dir: string): number {
  if (!existsSync(dir)) return 0;

  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

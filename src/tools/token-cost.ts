/**
 * Summarize token usage and estimated cost: every agent's own session records,
 * PAL's inference log, and rtk's savings.
 */

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { AGENT_REGISTRY, type AgentName } from "../hooks/lib/agent-registry";
import { palHome, platform } from "../hooks/lib/paths";
import { findBinaryOnPath } from "../hooks/lib/which";
import { readCodex, readCopilot, readOpencode } from "./lib/agent-usage";
import {
  type AgentReport,
  parseRtkSummary,
  type RtkGain,
  type UsageData,
} from "./lib/token-report";
import { readClaudeCode, readPalInference } from "./lib/usage-buckets";

const UNTRACKED_AGENTS: AgentName[] = ["cursor", "antigravity"];

function opencodeDatabase(): string {
  const dataHome = process.env.XDG_DATA_HOME || resolve(homedir(), ".local", "share");
  return resolve(dataHome, "opencode", "opencode.db");
}

function agentReports(project: string | undefined): AgentReport[] {
  const report = (agent: AgentName, read: () => AgentReport["usage"]) => ({
    label: AGENT_REGISTRY[agent].label,
    usage: read(),
  });
  return [
    report("claude", () =>
      readClaudeCode(resolve(platform.claudeDir(), "projects"), project)
    ),
    report("codex", () => readCodex(platform.codexDir(), project)),
    report("opencode", () => readOpencode(opencodeDatabase(), project)),
    report("copilot", () => readCopilot(platform.copilotDir(), project)),
  ];
}

const installedUntracked = () =>
  UNTRACKED_AGENTS.filter((agent) => findBinaryOnPath(AGENT_REGISTRY[agent].binary)).map(
    (agent) => AGENT_REGISTRY[agent].label
  );

function rtkGain(): RtkGain {
  const rtk = findBinaryOnPath("rtk");
  if (!rtk) return { installed: false, summary: null };
  const result = spawnSync(rtk, ["gain", "--format", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return {
    installed: true,
    summary: parseRtkSummary(result.status, result.stdout ?? ""),
  };
}

export function collectUsage(project: string | undefined): UsageData {
  return {
    agents: agentReports(project),
    pal: readPalInference(resolve(palHome(), "memory", "signals", "token-usage.jsonl")),
    rtk: rtkGain(),
    untracked: installedUntracked(),
  };
}

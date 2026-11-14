/**
 * Summarize token usage and estimated cost: every agent's own session records,
 * PAL's inference log, and rtk's savings.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { allEventsSince, type LoggedEvent } from "../bronze/events";
import { transcriptArchive } from "../bronze/transcript-preserve";
import { AGENT_REGISTRY, type AgentName } from "../core/agent-registry";
import { platform } from "../core/paths";
import { readBindings } from "../core/project-bindings";
import { findBinaryOnPath } from "../core/which";
import { readAllProjects } from "../hooks/lib/projects";
import {
  opencodeDatabase,
  readCodex,
  readCopilot,
  readOpencode,
} from "./lib/agent-usage";
import { projectResolver } from "./lib/project-resolver";
import {
  type AgentReport,
  parseRtkSummary,
  type RtkGain,
  type UsageData,
} from "./lib/token-report";
import { readClaudeCode, readPalInference } from "./lib/usage-buckets";

const UNTRACKED_AGENTS: AgentName[] = ["cursor", "antigravity"];

function agentReports(project: string | undefined): AgentReport[] {
  const report = (agent: AgentName, read: () => AgentReport["usage"]) => ({
    label: AGENT_REGISTRY[agent].label,
    usage: read(),
  });
  const projectOf = projectResolver(readAllProjects(), readBindings());

  return [
    report("claude", () =>
      readClaudeCode(
        resolve(platform.claudeDir(), "projects"),
        project,
        new Date(),
        transcriptArchive(),
        projectOf
      )
    ),
    report("codex", () => readCodex(platform.codexDir(), project, new Date(), projectOf)),
    report("opencode", () =>
      readOpencode(opencodeDatabase(), project, new Date(), projectOf)
    ),
    report("copilot", () =>
      readCopilot(platform.copilotDir(), project, new Date(), projectOf)
    ),
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

/** PAL's inference and System One judgment events, read from the log once. */
export function palInferenceEvents(): LoggedEvent[] {
  return allEventsSince(new Date(0)).filter(
    (e) => e.type === "inference_call" || e.type === "judge_call"
  );
}

export function collectUsage(project: string | undefined): UsageData {
  return {
    agents: agentReports(project),
    pal: readPalInference(palInferenceEvents()),
    rtk: rtkGain(),
    untracked: installedUntracked(),
  };
}

/**
 * Summarize token usage and estimated cost.
 *
 * Reads from two sources:
 * 1. Claude Code session transcripts (~/.claude/projects/)
 * 2. PAL Haiku inference logs (memory/signals/token-usage.jsonl)
 */

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { palHome } from "../hooks/lib/paths";
import { findBinaryOnPath } from "../hooks/lib/which";
import { leaf, runCommand } from "./lib/command";
import { scriptArgs } from "./lib/script-args";
import { parseRtkSummary, type RtkGain, usageLines } from "./lib/token-report";
import { readClaudeCode, readPalInference } from "./lib/usage-buckets";

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

function printUsage(project: string | undefined): undefined {
  const lines = usageLines(
    readClaudeCode(resolve(homedir(), ".claude", "projects"), project),
    readPalInference(resolve(palHome(), "memory", "signals", "token-usage.jsonl")),
    rtkGain()
  );
  for (const line of lines) console.log(line);
}

export const usageCommand = leaf({
  summary: "Summarize token usage and estimated cost for today, 7 and 30 days",
  options: {
    project: {
      type: "string",
      value: "<name>",
      description: "Only Claude Code sessions of this project",
    },
  },
  run: ({ values }) => printUsage(values.project),
});

if (import.meta.main)
  process.exit(await runCommand(usageCommand, scriptArgs(), ["pal", "cli", "usage"]));

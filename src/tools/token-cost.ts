/**
 * Summarize token usage and estimated cost.
 *
 * Reads from two sources:
 * 1. Claude Code session transcripts (~/.claude/projects/)
 * 2. PAL Haiku inference logs (memory/signals/token-usage.jsonl)
 *
 * Invoked via `pal cli usage [--today|--week|--month|--all] [--project <name>]`.
 */

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { palHome } from "../hooks/lib/paths";
import { findBinaryOnPath } from "../hooks/lib/which";
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

export function usage() {
  const { values } = parseArgs({
    options: {
      today: { type: "boolean", default: false },
      week: { type: "boolean", default: false },
      month: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      project: { type: "string" },
    },
    strict: false,
  });

  const lines = usageLines(
    readClaudeCode(resolve(homedir(), ".claude", "projects"), values.project as string),
    readPalInference(resolve(palHome(), "memory", "signals", "token-usage.jsonl")),
    rtkGain()
  );
  for (const line of lines) console.log(line);
}

if (import.meta.main) usage();

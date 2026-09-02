#!/usr/bin/env bun

/**
 * AlgorithmReflect — Append structured algorithm reflections to JSONL.
 *
 * Records algorithm performance data after each LEARN phase.
 * Creates a queryable dataset for improving the algorithm over time.
 *
 * Usage:
 *   bun run tool:algorithm-reflect --task "description" --criteria 5 --passed 4 --failed 1 --sentiment 7 \
 *     --q1 "Should have read the file before planning" \
 *     --q2 "Could have parallelized the explore agents" \
 *     --q3 "Missed the implicit constraint about cross-platform"
 */

import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { encodeAnchor } from "../../hooks/lib/anchor";
import { loadMachine } from "../../hooks/lib/machine";
import { paths } from "../../hooks/lib/paths";
import { emit } from "../lib/emit";

// ── Types ──

interface AlgorithmReflection {
  timestamp: string;
  cwd: string;
  m: string;
  task: string;
  criteria_count: number;
  criteria_passed: number;
  criteria_failed: number;
  sentiment: number;
  q1: string;
  q2: string;
  q3: string;
  /** general = the improvement ideas generalize to the algorithm; task-specific = bound to this task. */
  scope: "general" | "task-specific";
}

// ── Core ──

function reflectionsPath(): string {
  paths.reflections(); // ensures the directory exists
  return paths.reflectionsFile();
}

/**
 * Assemble a reflection record from CLI-style input, stamping the current
 * cwd (anchored) and this machine's id. Exported so the stamping logic is
 * directly testable without going through argv parsing.
 */
export function buildReflection(input: {
  task: string;
  q1: string;
  q2: string;
  q3: string;
  criteria_count?: number;
  criteria_passed?: number;
  criteria_failed?: number;
  sentiment?: number;
  scope?: string;
}): AlgorithmReflection {
  return {
    timestamp: new Date().toISOString(),
    cwd: encodeAnchor(process.cwd()),
    m: loadMachine().id,
    task: input.task,
    criteria_count: input.criteria_count ?? 0,
    criteria_passed: input.criteria_passed ?? 0,
    criteria_failed: input.criteria_failed ?? 0,
    sentiment: Math.max(1, Math.min(10, input.sentiment ?? 5)),
    q1: input.q1,
    q2: input.q2,
    q3: input.q3,
    // Default to general (the ~94% case); only "task-specific" suppresses it
    // from algorithm-update clustering.
    scope: input.scope === "task-specific" ? "task-specific" : "general",
  };
}

function appendReflection(reflection: AlgorithmReflection): {
  success: boolean;
  message: string;
  path: string;
} {
  const p = reflectionsPath();
  const line = `${JSON.stringify(reflection)}\n`;
  appendFileSync(p, line, "utf-8");

  return {
    success: true,
    message: `Reflection logged: ${reflection.criteria_passed}/${reflection.criteria_count} passed, sentiment ${reflection.sentiment}/10`,
    path: p,
  };
}

// ── CLI ──

function run() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      task: { type: "string" },
      criteria: { type: "string" },
      passed: { type: "string" },
      failed: { type: "string" },
      sentiment: { type: "string" },
      q1: { type: "string" },
      q2: { type: "string" },
      q3: { type: "string" },
      scope: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
AlgorithmReflect — Log algorithm performance after LEARN phase

Usage:
  bun run tool:algorithm-reflect --task "description" --criteria N --passed N --failed N --sentiment 1-10 \\
    --q1 "self reflection" --q2 "algorithm reflection" --q3 "AI reflection"

Arguments:
  --task        Brief task description
  --criteria    Total criteria count
  --passed      Criteria passed
  --failed      Criteria failed
  --sentiment   Implied satisfaction 1-10
  --q1          Q1 — Self: what I'd do differently
  --q2          Q2 — Algorithm: structural improvement
  --q3          Q3 — AI: reasoning blind spot
  --scope       general (default) | task-specific — is the algorithm idea reusable or task-bound?

Output: algorithm-reflections.jsonl in memory/learning/reflections/
`);
    process.exit(0);
  }

  if (!values.task || !values.q1 || !values.q2 || !values.q3) {
    console.error("Required: --task, --q1, --q2, --q3");
    process.exit(1);
  }

  const reflection = buildReflection({
    task: values.task,
    q1: values.q1,
    q2: values.q2,
    q3: values.q3,
    criteria_count: parseInt(values.criteria || "0", 10),
    criteria_passed: parseInt(values.passed || "0", 10),
    criteria_failed: parseInt(values.failed || "0", 10),
    sentiment: parseInt(values.sentiment || "5", 10),
    scope: values.scope,
  });

  const result = appendReflection(reflection);
  emit.ok(result.message);
}

if (import.meta.main) run();

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

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { paths } from "../../hooks/lib/paths";

// ── Types ──

interface AlgorithmReflection {
  timestamp: string;
  task: string;
  criteria_count: number;
  criteria_passed: number;
  criteria_failed: number;
  sentiment: number;
  q1: string;
  q2: string;
  q3: string;
}

// ── Core ──

function reflectionsPath(): string {
  const dir = resolve(paths.learning(), "reflections");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return resolve(dir, "algorithm-reflections.jsonl");
}

export function appendReflection(reflection: AlgorithmReflection): {
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

Output: algorithm-reflections.jsonl in memory/learning/reflections/
`);
    process.exit(0);
  }

  if (!values.task || !values.q1 || !values.q2 || !values.q3) {
    console.error("Required: --task, --q1, --q2, --q3");
    process.exit(1);
  }

  const reflection: AlgorithmReflection = {
    timestamp: new Date().toISOString(),
    task: values.task,
    criteria_count: parseInt(values.criteria || "0", 10),
    criteria_passed: parseInt(values.passed || "0", 10),
    criteria_failed: parseInt(values.failed || "0", 10),
    sentiment: Math.max(1, Math.min(10, parseInt(values.sentiment || "5", 10))),
    q1: values.q1,
    q2: values.q2,
    q3: values.q3,
  };

  const result = appendReflection(reflection);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) run();

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
import { paths } from "../../hooks/lib/paths";
import { buildReflection, intOr, reflectionLine } from "../lib/algorithm-reflect";
import { emit } from "../lib/emit";

const HELP = `
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
`;

function reflectionsPath(): string {
  paths.reflections();
  return paths.reflectionsFile();
}

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
    console.log(HELP);
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
    criteria_count: intOr(values.criteria, 0),
    criteria_passed: intOr(values.passed, 0),
    criteria_failed: intOr(values.failed, 0),
    sentiment: intOr(values.sentiment, 5),
    scope: values.scope,
  });

  const path = reflectionsPath();
  appendFileSync(path, reflectionLine(reflection), "utf-8");
  emit.receipt(path, {
    passed: reflection.criteria_passed,
    of: reflection.criteria_count,
    scope: reflection.scope,
  });
}

if (import.meta.main) run();

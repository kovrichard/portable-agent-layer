#!/usr/bin/env bun

/**
 * AlgorithmReflect — Append structured algorithm reflections to JSONL.
 *
 * Records algorithm performance data after each LEARN phase.
 * Creates a queryable dataset for improving the algorithm over time.
 *
 * Usage: pal cli algorithm-reflect --task "…" --q1 "…" --q2 "…" --q3 "…" [options]
 */

import { appendFileSync } from "node:fs";
import { paths } from "../../hooks/lib/paths";
import { buildReflection, intOr, reflectionLine } from "../lib/algorithm-reflect";
import { leaf, runCommand, UsageError } from "../lib/command";
import { emit } from "../lib/emit";
import { scriptArgs } from "../lib/script-args";

const DETAILS = `Required: --task, --q1, --q2, --q3.

Example:
  pal cli algorithm-reflect --task "description" --criteria N --passed N --failed N --sentiment 1-10 \\
    --q1 "self reflection" --q2 "algorithm reflection" --q3 "AI reflection"

Output: algorithm-reflections.jsonl in memory/learning/reflections/`;

const REQUIRED = ["task", "q1", "q2", "q3"] as const;

export const command = leaf({
  summary: "Log algorithm performance after the LEARN phase",
  options: {
    task: { type: "string", value: "<text>", description: "Brief task description" },
    criteria: { type: "string", value: "<n>", description: "Total criteria count" },
    passed: { type: "string", value: "<n>", description: "Criteria passed" },
    failed: { type: "string", value: "<n>", description: "Criteria failed" },
    sentiment: {
      type: "string",
      value: "<1-10>",
      description: "Implied satisfaction 1-10",
    },
    q1: {
      type: "string",
      value: "<text>",
      description: "Q1 — Self: what I'd do differently",
    },
    q2: {
      type: "string",
      value: "<text>",
      description: "Q2 — Algorithm: structural improvement",
    },
    q3: { type: "string", value: "<text>", description: "Q3 — AI: reasoning blind spot" },
    scope: {
      type: "string",
      value: "<scope>",
      description:
        "general (default) | task-specific — is the algorithm idea reusable or task-bound?",
    },
  },
  details: DETAILS,
  run: ({ values }) => {
    const { task, q1, q2, q3 } = values;
    if (!task || !q1 || !q2 || !q3) throw new UsageError(missingRequired(values));
    return appendReflection(
      buildReflection({
        task,
        q1,
        q2,
        q3,
        criteria_count: intOr(values.criteria, 0),
        criteria_passed: intOr(values.passed, 0),
        criteria_failed: intOr(values.failed, 0),
        sentiment: intOr(values.sentiment, 5),
        scope: values.scope,
      })
    );
  },
});

export function run(argv: string[] = scriptArgs()): Promise<number> {
  return runCommand(command, argv, ["pal", "cli", "algorithm-reflect"]);
}

function missingRequired(
  values: Partial<Record<(typeof REQUIRED)[number], string>>
): string {
  const missing = REQUIRED.filter((name) => !values[name]).map((name) => `--${name}`);
  return `missing ${missing.join(", ")}`;
}

function reflectionsPath(): string {
  paths.reflections();
  return paths.reflectionsFile();
}

function appendReflection(reflection: ReturnType<typeof buildReflection>): undefined {
  const path = reflectionsPath();
  appendFileSync(path, reflectionLine(reflection), "utf-8");
  emit.receipt(path, {
    passed: reflection.criteria_passed,
    of: reflection.criteria_count,
    scope: reflection.scope,
  });
}

if (import.meta.main) process.exit(await run());

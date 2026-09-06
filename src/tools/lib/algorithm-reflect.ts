/**
 * The shape of an algorithm reflection: what a LEARN phase records, and the
 * defaults and clamps applied to whatever the CLI was handed.
 *
 * The tool around this is only ever spawned, so the stamping, the clamp and the
 * scope default were reachable only through argv. They take their clock and
 * their directory as parameters here, which is what makes them assertable.
 */

import { currentAttribution, type RecordAttribution } from "../../hooks/lib/actor";
import { encodeAnchor } from "../../hooks/lib/anchor";

const MIN_SENTIMENT = 1;
const MAX_SENTIMENT = 10;
const DEFAULT_SENTIMENT = 5;

export interface AlgorithmReflection extends RecordAttribution {
  timestamp: string;
  cwd: string;
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

export interface ReflectionInput {
  task: string;
  q1: string;
  q2: string;
  q3: string;
  criteria_count?: number;
  criteria_passed?: number;
  criteria_failed?: number;
  sentiment?: number;
  scope?: string;
}

/** An absent flag reads as its default; a non-numeric one reads as NaN, not zero. */
export function intOr(value: string | undefined, fallback: number): number {
  return Number.parseInt(value || String(fallback), 10);
}

export function clampSentiment(sentiment: number | undefined): number {
  return Math.max(MIN_SENTIMENT, Math.min(MAX_SENTIMENT, sentiment ?? DEFAULT_SENTIMENT));
}

/**
 * General is the ~94% case, so only an explicit "task-specific" opts out of
 * algorithm-update's clustering — anything else, including a typo, stays general.
 */
export function scopeOf(scope: string | undefined): AlgorithmReflection["scope"] {
  return scope === "task-specific" ? "task-specific" : "general";
}

export function buildReflection(
  input: ReflectionInput,
  now: Date = new Date(),
  cwd: string = process.cwd()
): AlgorithmReflection {
  return {
    timestamp: now.toISOString(),
    cwd: encodeAnchor(cwd),
    ...currentAttribution(),
    task: input.task,
    criteria_count: input.criteria_count ?? 0,
    criteria_passed: input.criteria_passed ?? 0,
    criteria_failed: input.criteria_failed ?? 0,
    sentiment: clampSentiment(input.sentiment),
    q1: input.q1,
    q2: input.q2,
    q3: input.q3,
    scope: scopeOf(input.scope),
  };
}

export function reflectionLine(reflection: AlgorithmReflection): string {
  return `${JSON.stringify(reflection)}\n`;
}

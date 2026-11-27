/**
 * The adaptation rules as an append-only log: each line is one rule's whole
 * state at a time. Reading keeps each rule's newest line, so two machines that
 * draft and decide rules merge line by line. Rules from before the log, in
 * rules.json, read as lines stamped with their own last change until the
 * migration moves them in.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { storeDir } from "../bronze/bronze";
import { linesNotIn } from "../core/import-merge";
import { paths } from "../core/paths";

export interface LoggedRule {
  id: string;
  createdAt: string;
  decidedAt?: string;
  retiredAt?: string;
}

interface RuleLine<R extends LoggedRule> {
  at: string;
  rule: R;
}

export const ruleLogPath = () => resolve(storeDir("rules"), "rules.jsonl");

export const legacyRulesPath = () => resolve(paths.adaptation(), "rules.json");

function parseLine<R extends LoggedRule>(line: string): RuleLine<R> | null {
  try {
    const parsed = JSON.parse(line) as RuleLine<R>;

    return typeof parsed.at === "string" && typeof parsed.rule?.id === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function legacyRules(): LoggedRule[] {
  if (!existsSync(legacyRulesPath())) return [];

  try {
    const parsed = JSON.parse(readFileSync(legacyRulesPath(), "utf-8"));

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** A rule from rules.json as a log line: the same bytes on every machine that holds it. */
function importLine(rule: LoggedRule): string {
  return JSON.stringify({ at: rule.retiredAt ?? rule.decidedAt ?? rule.createdAt, rule });
}

export function legacyRuleLines(): string[] {
  return legacyRules().map(importLine);
}

function logText(): string {
  return existsSync(ruleLogPath()) ? readFileSync(ruleLogPath(), "utf-8") : "";
}

function newer<R extends LoggedRule>(kept: RuleLine<R>, other: RuleLine<R>): RuleLine<R> {
  if (kept.at !== other.at) return other.at > kept.at ? other : kept;

  return JSON.stringify(other) > JSON.stringify(kept) ? other : kept;
}

function newestLines<R extends LoggedRule>(): Map<string, RuleLine<R>> {
  const newest = new Map<string, RuleLine<R>>();

  for (const text of [...legacyRuleLines(), logText()].join("\n").split("\n")) {
    const line = parseLine<R>(text);
    if (!line) continue;
    const seen = newest.get(line.rule.id);
    newest.set(line.rule.id, seen ? newer(seen, line) : line);
  }

  return newest;
}

/** Every rule as its newest line has it, in the order the rules first appear. */
export function readRuleLog<R extends LoggedRule>(): R[] {
  return [...newestLines<R>().values()].map((line) => line.rule);
}

function stampAfter(previous: string | undefined, now: Date): string {
  const after = previous ? Date.parse(previous) + 1 : 0;

  return new Date(Math.max(now.getTime(), after)).toISOString();
}

/** Appends the rule's new state, stamped after its last one. */
export function saveRule<R extends LoggedRule>(rule: R, now: Date = new Date()): void {
  const at = stampAfter(newestLines().get(rule.id)?.at, now);
  appendFileSync(ruleLogPath(), `${JSON.stringify({ at, rule })}\n`);
}

/** Appends the rules.json lines the log lacks; returns how many. */
export function moveLegacyRulesIntoLog(): number {
  const added = linesNotIn(logText(), legacyRuleLines().join("\n"));
  if (added.length > 0) appendFileSync(ruleLogPath(), `${added.join("\n")}\n`);

  return added.length;
}

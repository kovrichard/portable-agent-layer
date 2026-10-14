/**
 * Scores the rule drafter on its test set: a private, frozen replay of live
 * corrections. Never tune the prompt on it.
 *   bun run eval:rule-drafter:test [runs] [file]
 *
 * Each record is a confirmed correction with the groups it belongs to: a group
 * is the corrections one instruction would have prevented. Every correction not
 * used for the validation cases becomes the newest once, with every earlier one before
 * it, as the drafter sees them live. It must draft when an earlier correction
 * shares a group and cite only those; otherwise it must not. The proof runs
 * over the live log as it stood at the newest record.
 */

import { resolve } from "node:path";
import { readTurns, withRequests } from "../../src/hooks/lib/adaptation-turns";
import { inference } from "../../src/hooks/lib/inference";
import { paths } from "../../src/hooks/lib/paths";
import { drafterRequest } from "../../src/hooks/lib/rule-drafter";
import { asTurns, type DrafterCase } from "./cases";
import { type Grade, grade, gradeNext, gradeTrigger } from "./grading";

interface TestRecord {
  ts: string;
  prompt: string;
  replyEnd: string;
  message: string;
  issue: string;
  groups: string[];
  /** Used for a validation case; the frozen file names it dev. */
  dev: boolean;
}

const CONCURRENCY = 4;
const PROOF_DAYS = 30;

function defaultSetPath(): string {
  return resolve(paths.adaptation(), "test-sets", "rule-drafter.jsonl");
}

async function readRecords(path: string): Promise<TestRecord[]> {
  const lines = (await Bun.file(path).text()).trim().split("\n");
  return lines.map((line) => JSON.parse(line) as TestRecord);
}

const shareGroup = (a: TestRecord, b: TestRecord) =>
  a.groups.some((group) => b.groups.includes(group));

function caseFor(records: TestRecord[], index: number): DrafterCase {
  const newest = records[index];
  const earlier = records.slice(0, index);
  const outside = earlier.flatMap((r, n) => (shareGroup(r, newest) ? [] : [n]));
  const recurring = outside.length < earlier.length;
  const next = records.slice(index + 1).find((r) => shareGroup(r, newest));
  return {
    id: newest.ts,
    description: newest.groups.join(",") || "alone",
    corrections: records.slice(0, index + 1),
    expect: recurring
      ? { recurring: true, mustCite: [], mustNotCite: outside }
      : { recurring: false },
    ...(recurring && next ? { next } : {}),
  };
}

async function draftOutput(c: DrafterCase): Promise<string> {
  const result = await inference(drafterRequest(asTurns(c.corrections), []));
  return result.success ? (result.output ?? "") : "";
}

async function inBatches<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY)
    results.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(run))));
  return results;
}

interface Scored {
  c: DrafterCase;
  decided: Grade;
  trigger: Grade & { tried: boolean };
  next: Grade;
}

function summary(scored: Scored[]): string[] {
  const of = (pick: (s: Scored) => boolean, pass: (s: Scored) => boolean) => {
    const picked = scored.filter(pick);
    return `${picked.filter(pass).length}/${picked.length}`;
  };
  const recurring = (s: Scored) => "mustCite" in s.c.expect;
  return [
    `decided as expected: ${of(
      () => true,
      (s) => s.decided.pass
    )}`,
    `  repeats an earlier one: ${of(recurring, (s) => s.decided.pass)}`,
    `  stands alone: ${of(
      (s) => !recurring(s),
      (s) => s.decided.pass
    )}`,
    `decided drafts with a trigger that proves: ${of(
      (s) => recurring(s) && s.decided.pass && s.trigger.tried,
      (s) => s.trigger.pass
    )}`,
    `  of all decided drafts, with a trigger: ${of(
      (s) => recurring(s) && s.decided.pass,
      (s) => s.trigger.tried
    )}`,
    `triggers that catch the next one: ${of(
      (s) => !!s.c.next && s.trigger.tried,
      (s) => s.next.pass
    )}`,
  ];
}

const runs = Number(process.argv[2] ?? 1);
const records = await readRecords(process.argv[3] ?? defaultSetPath());
const newestAt = new Date(records[records.length - 1].ts);
const proofTurns = withRequests(readTurns(PROOF_DAYS, newestAt));
const cases = records.flatMap((r, i) => (r.dev ? [] : [caseFor(records, i)]));
const attempts = Array.from({ length: runs }, () => cases).flat();

const scored = await inBatches(attempts, async (c) => {
  const output = await draftOutput(c);
  return {
    c,
    decided: grade(c, output, proofTurns),
    trigger: gradeTrigger(c, output, proofTurns),
    next: gradeNext(c, output),
  };
});
for (const s of scored.filter((s) => !s.decided.pass))
  console.log(`${s.c.id} ${s.c.description}  ${s.decided.reason}`);
console.log(summary(scored).join("\n"));

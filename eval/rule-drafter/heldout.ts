/**
 * Scores the rule drafter on a private, frozen replay of live corrections.
 * Never tune the prompt on it.
 *   bun run eval:rule-drafter:heldout [runs] [file]
 *
 * Each record is a confirmed correction with the groups it belongs to: a group
 * is the corrections one instruction would have prevented. Every correction not
 * used for the dev cases becomes the newest once, with every earlier one before
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
import { type Grade, grade, gradeNext } from "./grading";

interface HeldOutRecord {
  ts: string;
  prompt: string;
  replyEnd: string;
  message: string;
  issue: string;
  groups: string[];
  dev: boolean;
}

const CONCURRENCY = 4;
const PROOF_DAYS = 30;

function defaultSetPath(): string {
  return resolve(paths.adaptation(), "heldout", "rule-drafter.jsonl");
}

async function readRecords(path: string): Promise<HeldOutRecord[]> {
  const lines = (await Bun.file(path).text()).trim().split("\n");
  return lines.map((line) => JSON.parse(line) as HeldOutRecord);
}

const shareGroup = (a: HeldOutRecord, b: HeldOutRecord) =>
  a.groups.some((group) => b.groups.includes(group));

function caseFor(records: HeldOutRecord[], index: number): DrafterCase {
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
    `catches the next one: ${of(
      (s) => !!s.c.next,
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
  return { c, decided: grade(c, output, proofTurns), next: gradeNext(c, output) };
});
for (const s of scored.filter((s) => !s.decided.pass || !s.next.pass))
  console.log(
    `${s.c.id} ${s.c.description}  ${s.decided.pass ? "" : s.decided.reason}${s.next.pass ? "" : `  next: ${s.next.reason}`}`
  );
console.log(summary(scored).join("\n"));

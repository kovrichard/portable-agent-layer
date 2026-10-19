/**
 * Scores the decision-label prompt on real turns. Both sets are private, live
 * conversation that cannot go in the repo: tune on the validation set, score
 * the frozen test set once.
 *   bun run eval:decision          validation set
 *   bun run eval:decision:test     test set
 */

import { resolve } from "node:path";
import { decisionRequest, parseDecision } from "../../src/hooks/lib/decision-label";
import { inference } from "../../src/hooks/lib/inference";
import { paths } from "../../src/hooks/lib/paths";

interface Case {
  id: string;
  message: string;
  reply: string;
  accept: ("yes" | "no")[];
}

const CONCURRENCY = 6;

function setPath(set: string): string {
  return resolve(paths.adaptation(), `${set}-sets`, "decision.jsonl");
}

async function readCases(path: string): Promise<Case[]> {
  const lines = (await Bun.file(path).text()).trim().split("\n");
  return lines.map((line) => JSON.parse(line) as Case);
}

async function labelCase(c: Case) {
  const result = await inference(decisionRequest(c.message, c.reply));
  const label = result.success ? parseDecision(result.output) : null;
  if (!label) return { ...c, answer: "failed", what: "" };
  return { ...c, answer: label.decision ? "yes" : "no", what: label.what };
}

async function labelAll(cases: Case[]) {
  const results: Awaited<ReturnType<typeof labelCase>>[] = [];
  for (let i = 0; i < cases.length; i += CONCURRENCY)
    results.push(...(await Promise.all(cases.slice(i, i + CONCURRENCY).map(labelCase))));
  return results;
}

const set = process.argv[2] ?? "validation";
const results = await labelAll(await readCases(setPath(set)));
const scored = results.filter((r) => r.accept.length === 1);
const wrong = scored.filter((r) => r.answer !== r.accept[0]);
for (const r of wrong)
  console.log(
    `${r.id}  got ${r.answer}, want ${r.accept[0]}  ${r.what}\n  ${r.message.slice(0, 140).replace(/\n+/g, " ")}`
  );
const count = (want: string, got: string) =>
  scored.filter((r) => r.accept[0] === want && r.answer === got).length;
console.log(
  `${set}: ${scored.length - wrong.length}/${scored.length} right; missed decisions ${count("yes", "no")}, false decisions ${count("no", "yes")}, failed ${results.filter((r) => r.answer === "failed").length}`
);

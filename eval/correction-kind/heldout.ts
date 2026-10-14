/**
 * Scores the correction-kind prompt on a private, frozen set of live
 * corrections. Never tune the prompt on it.
 *   bun run eval:correction-kind:heldout [file]
 */

import { resolve } from "node:path";
import type { Turn } from "../../src/hooks/lib/adaptation-turns";
import { labelWithInference } from "../../src/hooks/lib/correction-backfill";
import { paths } from "../../src/hooks/lib/paths";

interface HeldOutCase {
  id: string;
  replyEnd: string;
  message: string;
  issue: string;
  accept: string[];
}

function defaultSetPath(): string {
  return resolve(paths.adaptation(), "heldout", "correction-kind.jsonl");
}

async function readCases(path: string): Promise<HeldOutCase[]> {
  const lines = (await Bun.file(path).text()).trim().split("\n");
  return lines.map((line) => JSON.parse(line) as HeldOutCase);
}

async function labelCase(c: HeldOutCase) {
  const turn: Turn = { ...c, ts: c.id, session: "heldout", reaction: "corrected" };
  const kind = (await labelWithInference(turn))?.kind ?? "failed";
  return { ...c, kind, accepted: c.accept.includes(kind), first: c.accept[0] === kind };
}

const results = await Promise.all(
  (await readCases(process.argv[2] ?? defaultSetPath())).map(labelCase)
);
for (const r of results.filter((r) => !r.accepted))
  console.log(`${r.id}  got ${r.kind}, accepts ${r.accept.join("|")}`);
const count = (pick: (r: (typeof results)[number]) => boolean) =>
  results.filter(pick).length;
console.log(
  `${count((r) => r.accepted)}/${results.length} accepted, ${count((r) => r.first)}/${results.length} on the first choice`
);

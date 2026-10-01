/**
 * A rolling, local sample of labelled messages with the reply they answered,
 * kept so the reaction rules can be audited against the user's real language.
 * Follow-ups get most of the room: that is where the rules' misses land.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Reaction } from "./interaction-reaction";
import { paths } from "./paths";
import { isEnabled } from "./settings";

export interface ReactionSample {
  ts: string;
  session: string;
  reaction: Reaction;
  text: string;
  replyEnd: string;
}

const KEPT: Record<Reaction, number> = {
  "follow-up": 150,
  approved: 20,
  corrected: 20,
  repeated: 20,
  "new-topic": 20,
};
const TEXT_MAX = 1000;
const REPLY_END_MAX = 600;

function samplesFile(): string {
  return resolve(paths.state(), "reaction-samples.json");
}

/** @lintignore exercised directly by test/interaction-samples.test.ts */
export function readSamples(): ReactionSample[] {
  try {
    return JSON.parse(readFileSync(samplesFile(), "utf-8"));
  } catch {
    return [];
  }
}

/** A rare label keeps its own room, so frequent approvals never push out the corrections. */
function newestPerReaction(samples: ReactionSample[]): ReactionSample[] {
  const kept = (Object.keys(KEPT) as Reaction[]).flatMap((reaction) =>
    samples.filter((s) => s.reaction === reaction).slice(-KEPT[reaction])
  );
  return kept.sort((a, b) => a.ts.localeCompare(b.ts));
}

/** The end of a reply is what the user's next message usually answers. */
export function replyEnd(reply: string): string {
  return reply.trim().slice(-REPLY_END_MAX);
}

export function keepSample(sample: ReactionSample): void {
  if (!isEnabled("reactionSampling")) return;
  const trimmed = { ...sample, text: sample.text.slice(0, TEXT_MAX) };
  const samples = newestPerReaction([...readSamples(), trimmed]);
  writeFileSync(samplesFile(), JSON.stringify(samples), "utf-8");
}

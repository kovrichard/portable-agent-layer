/**
 * What the user's reactions say about the replies they get: for each shape a reply
 * can take, how often replies with it were approved against replies without it.
 * A split counts as evidence only with enough replies on both sides and a gap wider
 * than noise; the data is thin, so most splits are expected to say not yet.
 */

import { median } from "./interaction-mood";
import { approvalIsKnown } from "./interaction-reaction";

const MIN_REPLIES_PER_SIDE = 20;
const MIN_GAP = 0.1;

interface ReplyFeatures {
  words: number;
  listItems: number;
  headings: number;
  asked: boolean;
}

interface ReactedTurn {
  reply: ReplyFeatures | null;
  reaction: string | null;
  reactionRules?: number;
}

interface Outcome {
  reply: ReplyFeatures;
  approved: boolean;
}

export interface Side {
  replies: number;
  approved: number;
}

export interface Split {
  shape: string;
  opposite: string;
  has: Side;
  lacks: Side;
}

function outcomes(events: ReactedTurn[]): Outcome[] {
  return events.flatMap((e) =>
    e.reply && e.reaction && approvalIsKnown(e)
      ? [{ reply: e.reply, approved: e.reaction === "approved" }]
      : []
  );
}

function side(outcomes: Outcome[]): Side {
  return {
    replies: outcomes.length,
    approved: outcomes.filter((o) => o.approved).length,
  };
}

function splitBy(
  outcomes: Outcome[],
  shape: string,
  opposite: string,
  test: (reply: ReplyFeatures) => boolean
): Split {
  return {
    shape,
    opposite,
    has: side(outcomes.filter((o) => test(o.reply))),
    lacks: side(outcomes.filter((o) => !test(o.reply))),
  };
}

function lengthSplit(outcomes: Outcome[]): Split {
  const cut = Math.round(median(outcomes.map((o) => o.reply.words)) ?? 0);
  return splitBy(
    outcomes,
    `under ${cut} words`,
    `${cut} words or more`,
    (r) => r.words < cut
  );
}

export function splits(events: ReactedTurn[]): Split[] {
  const reacted = outcomes(events);
  return [
    lengthSplit(reacted),
    splitBy(reacted, "with a list", "without a list", (r) => r.listItems > 0),
    splitBy(reacted, "with headings", "without headings", (r) => r.headings > 0),
    splitBy(reacted, "ending with a question", "not ending with one", (r) => r.asked),
  ];
}

export function approvedShare(s: Side): number {
  return s.replies ? s.approved / s.replies : 0;
}

export function hasEnoughReplies(split: Split): boolean {
  return Math.min(split.has.replies, split.lacks.replies) >= MIN_REPLIES_PER_SIDE;
}

export function isEvidence(split: Split): boolean {
  const gap = Math.abs(approvedShare(split.has) - approvedShare(split.lacks));
  return hasEnoughReplies(split) && gap >= MIN_GAP;
}

export function reactedReplies(events: ReactedTurn[]): number {
  return outcomes(events).length;
}

/** The length split, when it is evidence that the user approves shorter replies. */
export function shorterApprovedMore(events: ReactedTurn[]): Split | null {
  const length = lengthSplit(outcomes(events));
  if (!isEvidence(length)) return null;
  return approvedShare(length.has) > approvedShare(length.lacks) ? length : null;
}

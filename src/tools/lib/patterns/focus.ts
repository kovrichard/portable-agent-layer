import type { Best } from "../wrapped/records";
import { type Activity, movesAttention } from "./activity";

export interface Focus {
  blocks: number;
  minutes: number;
  longest: Best | null;
}

interface Block {
  first: Activity;
  last: Activity;
}

const MINUTE_MS = 60_000;
const FOCUS_MINUTES = 90;
const MAX_GAP_MINUTES = 30;

const minutesOf = ({ first, last }: Block) => (last.ms - first.ms) / MINUTE_MS;

function continues(block: Block, next: Activity): boolean {
  return (
    next.project === block.last.project &&
    (next.ms - block.last.ms) / MINUTE_MS <= MAX_GAP_MINUTES
  );
}

/** A parallel session's model calls in another project leave the block alone; the user moving there ends it. */
function blocksOf(activity: Activity[]): Block[] {
  const blocks: Block[] = [];
  for (const next of activity) {
    const current = blocks.at(-1);
    if (current && continues(current, next)) current.last = next;
    else if (!current || current.last.project === next.project || movesAttention(next))
      blocks.push({ first: next, last: next });
  }
  return blocks;
}

/** 90 minutes or more on one project with no gap over 30. */
export function focusBlocks(activity: Activity[]): Focus | null {
  if (activity.length === 0) return null;
  const focused = blocksOf(activity).filter((b) => minutesOf(b) >= FOCUS_MINUTES);
  const longest = focused.reduce<Block | null>(
    (top, b) => (top === null || minutesOf(b) > minutesOf(top) ? b : top),
    null
  );
  return {
    blocks: focused.length,
    minutes: focused.reduce((sum, b) => sum + minutesOf(b), 0),
    longest:
      longest === null
        ? null
        : {
            value: minutesOf(longest),
            label: `${longest.first.project}, ${longest.first.day}`,
          },
  };
}

/**
 * The push-back a minimum run gives an agent that tries to stop before its
 * floor. No model runs here: the agent wrote the goal and bar at the start and
 * logs a round after each pass; this assembles them with a lens that rotates
 * on the rounds logged, so a push-back that demands a missing round skips none.
 */

import { isOver, type MinimumRound, minutesLeft, type Run } from "./run-mode";

export interface Lens {
  name: string;
  text: string;
}

export const LENSES: readonly Lens[] = [
  {
    name: "recheck",
    text: "Recheck the work against the brief or reference, one bar dimension at a time. Score each one again from the work itself, not from memory of it.",
  },
  {
    name: "critic",
    text: "Hand the work to a subagent with no context of this conversation. Give it the goal and the bar only, and ask it to score each dimension and name the weakest part. Fix what it finds.",
  },
  {
    name: "skeptic",
    text: "Read the work as a hostile reviewer, reader or user would. What would they attack first? Fix that.",
  },
  {
    name: "alternative",
    text: "Sketch a genuinely different approach to the goal. Compare it with the current one against the bar, and keep the better parts of each.",
  },
  {
    name: "simplify",
    text: "Cut what does not serve the goal: sections, steps, options, code or words that the bar does not need.",
  },
  {
    name: "verify",
    text: "Pick the claim or assumption the work leans on most and verify it with a tool or a source. Correct the work if it does not hold.",
  },
  {
    name: "end-user",
    text: "Use or read the work as the person it is for, start to finish. Fix the first place they would stumble.",
  },
];

export const ROUND_COMMAND =
  'pal cli minimum round --scores "<dimension: n/10, ...>" --weakest "<the weakest part now>" --did "<what this pass changed>"';

const ONLY_THE_USER =
  "Only the user ends a minimum run early; do not ask, decide and keep going.";

export function lensFor(blocks: number): Lens {
  return LENSES[blocks % LENSES.length] as Lens;
}

function skippedRound(run: Run): boolean {
  return run.stopBlocks > 0 && roundCount(run) === (run.roundsAtLastBlock ?? 0);
}

function roundCount(run: Run): number {
  return run.rounds?.length ?? 0;
}

function lastRound(run: Run): MinimumRound | null {
  return run.rounds?.at(-1) ?? null;
}

function lastRoundLines(run: Run): string[] {
  const round = lastRound(run);
  if (!round) return ["Last round: no round logged yet."];

  return [`Last round scores: ${round.scores}`, `Weakest point: ${round.weakest}`];
}

function barLines(run: Run): string[] {
  const bar = run.bar ?? [];

  return bar.length
    ? ["Bar:", ...bar.map((b) => `  - ${b}`)]
    : ["Bar: none set; write one into your next round's scores."];
}

function header(run: Run, now: Date): string {
  return `Minimum run: ${minutesLeft(run, now)} min left before the floor. You may not stop yet.`;
}

function footer(): string[] {
  return [`When the pass is done, log it: \`${ROUND_COMMAND}\``, ONLY_THE_USER];
}

function skippedRoundPrompt(run: Run, now: Date): string {
  return [
    header(run, now),
    "You stopped without logging a round. Do one pass on the weakest part, check it against the bar, then log it.",
    `Goal: ${run.goal ?? ""}`,
    ...footer(),
  ].join("\n");
}

function passPrompt(run: Run, now: Date): string {
  const lens = lensFor(roundCount(run));

  return [
    header(run, now),
    `Goal: ${run.goal ?? ""}`,
    ...barLines(run),
    ...lastRoundLines(run),
    `Next pass, lens "${lens.name}": ${lens.text}`,
    "Then fix the weakest part you find, and score honestly: a score that only rises is not a check.",
    ...footer(),
  ].join("\n");
}

const ASKED =
  "Your reply asks the user something. Questions belong in the intake, not the floor: pick the sensible default yourself, say which in the next round's --did, and keep going.";

/** The push-back for a stop before the floor, or null once the floor has passed. */
export function minimumStopReason(
  run: Run,
  now: Date = new Date(),
  replyAsked = false
): string | null {
  if (isOver(run, now)) return null;
  const prompt = skippedRound(run) ? skippedRoundPrompt(run, now) : passPrompt(run, now);

  return replyAsked ? `${ASKED}\n${prompt}` : prompt;
}

/** The lens the next push-back uses, or null when it is the skipped-round prompt. */
export function nextLensName(run: Run): string | null {
  return skippedRound(run) ? null : lensFor(roundCount(run)).name;
}

export function floorReachedMessage(run: Run): string {
  return `Minimum run: the floor is reached (${run.rounds?.length ?? 0} rounds logged). Do a final check against the bar, log the final round with \`${ROUND_COMMAND}\`, then summarise for the user: the goal, the final scores per bar dimension, what changed across the rounds, and what is still weakest.`;
}

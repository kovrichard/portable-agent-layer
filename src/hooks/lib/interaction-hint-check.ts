/**
 * Whether a reply followed the hint it was written under. A label saying the user
 * wants less asks for a reply at most half the user's usual one, the same factor
 * of two the mood rules use to call a message short.
 */

const ASKS_FOR_LESS = ["short", "fast", "skimming"];

function lengthTarget(usualReplyWords: number): number {
  return Math.round(usualReplyWords / 2);
}

export function asksForLess(moodKey: string | undefined): boolean {
  return (moodKey ?? "").split(",").some((label) => ASKS_FOR_LESS.includes(label));
}

/** Null when the reply was not written under a hint for less, or nothing says what usual is. */
export function followedHint(
  moodKey: string | undefined,
  replyWords: number | undefined,
  usualReplyWords: number | null
): boolean | null {
  if (replyWords === undefined || usualReplyWords === null) return null;
  if (!asksForLess(moodKey)) return null;
  return replyWords <= lengthTarget(usualReplyWords);
}

export function ignoredHintReminder(replyWords: number, usualReplyWords: number): string {
  const target = lengthTarget(usualReplyWords);
  return `<system-reminder>Interaction: the user still wants less. Your last reply was ${replyWords} words (usually ${usualReplyWords}); keep this one under ${target} words.</system-reminder>`;
}

/**
 * What the user's recent turns say about how they want to work right now,
 * measured against their own history rather than a fixed idea of a user.
 */

export interface MoodTurn {
  words: number;
  gapSec: number | null;
  afterBreak: boolean;
  skimmed: boolean;
  interrupted: boolean;
  repeated: boolean;
  corrected: boolean;
}

export interface Baseline {
  words: number;
  gapSec: number;
}

export const DEFAULT_BASELINE: Baseline = { words: 30, gapSec: 120 };

export interface Mood {
  key: string;
  facts: string[];
}

const WINDOW = 6;
const MIN_TURNS = 3;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function duration(sec: number): string {
  return sec < 90 ? `${Math.round(sec)}s` : `${Math.round(sec / 60)}m`;
}

/** A break starts a new sitting; turns before it describe a different moment. */
function currentSitting(turns: MoodTurn[]): MoodTurn[] {
  const lastBreak = turns.findLastIndex((t) => t.afterBreak);
  return turns.slice(Math.max(lastBreak, 0)).slice(-WINDOW);
}

/** Time away is not a signal of focus, so a break's own gap never counts toward pace. */
function paceFact(sitting: MoodTurn[], base: Baseline): [string, string] | null {
  const gaps = sitting
    .filter((t) => t.gapSec !== null && !t.afterBreak)
    .map((t) => t.gapSec as number);
  const pace = gaps.length >= MIN_TURNS ? median(gaps) : null;
  if (pace === null || pace > base.gapSec / 2) return null;
  return [
    "fast",
    `replying fast (median ${duration(pace)} after your reply, usually ${duration(base.gapSec)})`,
  ];
}

function lengthFact(sitting: MoodTurn[], base: Baseline): [string, string] | null {
  if (sitting.length < MIN_TURNS) return null;
  const words = median(sitting.map((t) => t.words)) as number;
  const usual = `median ${Math.round(words)} words, usually ${Math.round(base.words)}`;
  if (words <= base.words / 2) return ["short", `writing short messages (${usual})`];
  if (words >= base.words * 2) return ["long", `writing long messages (${usual})`];
  return null;
}

function countOf(turns: MoodTurn[], test: (t: MoodTurn) => boolean): number {
  return turns.filter(test).length;
}

function skimFact(sitting: MoodTurn[]): [string, string] | null {
  if (countOf(sitting.slice(-3), (t) => t.skimmed) < 2) return null;
  return ["skimming", "answering your recent replies faster than they can be read"];
}

function frictionFact(sitting: MoodTurn[]): [string, string] | null {
  const rough = (t: MoodTurn) => t.corrected || t.repeated || t.interrupted;
  if (countOf(sitting.slice(-4), rough) < 2) return null;
  return ["friction", "correcting, repeating or interrupting in recent turns"];
}

export function readMood(turns: MoodTurn[], base: Baseline): Mood {
  const sitting = currentSitting(turns);
  const found = [
    paceFact(sitting, base),
    lengthFact(sitting, base),
    skimFact(sitting),
    frictionFact(sitting),
  ].filter((f): f is [string, string] => f !== null);
  return { key: found.map(([label]) => label).join(","), facts: found.map(([, f]) => f) };
}

/** Said only when the picture changes, including once when it returns to normal. */
export function moodReminder(mood: Mood, previousKey: string): string | null {
  if (mood.key === previousKey) return null;
  const text = mood.key
    ? `Interaction, measured over this sitting: the user is ${mood.facts.join("; ")}. Adapt how you reply to this.`
    : "Interaction: the user's recent turns are back to their usual pattern.";
  return `<system-reminder>${text}</system-reminder>`;
}

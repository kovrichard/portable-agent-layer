/**
 * The flags the relationship-note tool takes, turned into notes to append.
 *
 * The tool is only ever spawned, so the one judgement here — what counts as a
 * usable confidence, and what an empty invocation should do — could not be
 * asserted from a test. A bad confidence is a typo, and writing the note anyway
 * under a default would record a claim nobody made.
 */

type NoteType = "O" | "W" | "Session";

interface NoteDraft {
  type: NoteType;
  text: string;
  confidence?: number;
}

export interface NoteFlags {
  o?: string[];
  w?: string[];
  b?: string;
  confidence?: string;
}

/** What an opinion is worth when the caller did not say. */
export const DEFAULT_CONFIDENCE = 0.75;

export type NoteFlagsResult = { notes: NoteDraft[] } | { error: string };

/** parseArgs leaves it a string; anything outside 0–1 is a typo, not a value. */
export function parseConfidence(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_CONFIDENCE;
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value) || value < 0 || value > 1) return null;
  return value;
}

export function notesFromFlags(flags: NoteFlags): NoteFlagsResult {
  const opinions = flags.o ?? [];
  const facts = flags.w ?? [];
  if (opinions.length === 0 && facts.length === 0 && !flags.b) {
    return { error: "Required: at least one of --o, --w, --b" };
  }

  const notes: NoteDraft[] = [];

  if (opinions.length > 0) {
    const confidence = parseConfidence(flags.confidence);
    if (confidence === null) {
      return { error: "--confidence must be a number between 0.0 and 1.0" };
    }
    for (const text of opinions) notes.push({ type: "O", text, confidence });
  }

  for (const text of facts) notes.push({ type: "W", text });
  if (flags.b) notes.push({ type: "Session", text: flags.b });

  return { notes };
}

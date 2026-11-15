/**
 * What one turn's assistant texts say about an ALGORITHM run, read in code.
 */

import { MODE_RE } from "./turn-extras";

export const PHASES = ["OBSERVE", "PLAN", "EXECUTE", "VERIFY", "LEARN"] as const;

type AlgorithmHeader = "pal" | "format";

export type RunVerdict = "no-node" | "started" | "over-open-run";

export interface AlgorithmTurnFacts {
  header: AlgorithmHeader;
  headerFirst: boolean;
  phases: string[];
  startsNew: boolean;
}

const LINE_START = "^[ \\t]*";
const PAL_HEADER_RE = new RegExp(`${LINE_START}${MODE_RE.source}`, "gm");
const FORMAT_HEADER_RE = /^[ \t]*♻️?\s*ALGORITHM\s*═{3,}/mu;
const PHASE_MARKER_RE =
  /^[ \t]*━━━[^\n]*?(OBSERVE|PLAN|EXECUTE|VERIFY|LEARN)[^\n]*?[1-5]\/5/gm;

function headerIn(text: string): AlgorithmHeader | null {
  const modes = Array.from(text.matchAll(PAL_HEADER_RE), (m) => m[1]);
  if (modes.includes("ALGORITHM")) return "pal";

  return FORMAT_HEADER_RE.test(text) ? "format" : null;
}

/** The phase markers across the texts, each named once, in the order first seen. */
export function phasesIn(texts: string[]): string[] {
  const seen = texts.flatMap((text) =>
    Array.from(text.matchAll(PHASE_MARKER_RE), (m) => m[1] as string)
  );

  return [...new Set(seen)];
}

export function algorithmTurnFacts(texts: string[]): AlgorithmTurnFacts | null {
  const headers = texts.map(headerIn);
  const header = headers.find((h) => h !== null);
  if (!header) return null;
  const phases = phasesIn(texts);

  return {
    header,
    headerFirst: Boolean(headers[0]),
    phases,
    startsNew: phases.includes("OBSERVE"),
  };
}

export function runVerdict(node: string | null, openRun: unknown): RunVerdict {
  if (node === null) return "no-node";

  return openRun ? "over-open-run" : "started";
}

/** The furthest phase reached, by the phase order, or null when none was written. */
export function lastPhase(phases: readonly string[]): string | null {
  const reached = PHASES.filter((phase) => phases.includes(phase));

  return reached.at(-1) ?? null;
}

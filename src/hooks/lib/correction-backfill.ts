/**
 * Labels the confirmed corrections that carry no kind of the current version, so
 * the rate of each kind has one labelling across its history. A relabel runs over
 * every confirmed correction again.
 */

import { readTurns, replaceTurns, type Turn, turnKey } from "./adaptation-turns";
import {
  type CorrectionKind,
  correctionKindRequest,
  hasCurrentKind,
  parseCorrectionKind,
  withCorrectionKind,
} from "./correction-kind";
import { inference } from "./inference";

export type KindLabeller = (turn: Turn) => Promise<CorrectionKind | null>;

export interface BackfillResult {
  labelled: number;
  failed: number;
}

export interface BackfillOptions {
  label?: KindLabeller;
  relabel?: boolean;
  onLabelled?: (turn: Turn, kind: CorrectionKind | null) => void;
}

export function correctionsToLabel(turns: Turn[], relabel = false): Turn[] {
  return turns.filter(
    (turn) => turn.confirmed === true && (relabel || !hasCurrentKind(turn))
  );
}

export async function labelWithInference(turn: Turn): Promise<CorrectionKind | null> {
  const request = correctionKindRequest(turn.replyEnd, turn.message, turn.issue);
  const result = await inference(request);
  return result.success ? parseCorrectionKind(result.output) : null;
}

export async function backfillCorrectionKinds(
  options: BackfillOptions = {}
): Promise<BackfillResult> {
  const label = options.label ?? labelWithInference;
  const replacements = new Map<string, Turn>();
  let failed = 0;
  for (const turn of correctionsToLabel(readTurns(), options.relabel)) {
    const kind = await label(turn);
    options.onLabelled?.(turn, kind);
    if (!kind) failed++;
    else replacements.set(turnKey(turn), { ...turn, ...withCorrectionKind(turn, kind) });
  }
  if (replacements.size > 0) replaceTurns(replacements);
  return { labelled: replacements.size, failed };
}

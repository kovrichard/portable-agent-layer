/**
 * Labels the confirmed corrections logged before the labeller existed, so the
 * rate of each kind has a history from the first opinion on.
 */

import { readTurns, replaceTurns, type Turn, turnKey } from "./adaptation-turns";
import {
  type CorrectionKind,
  correctionKindRequest,
  parseCorrectionKind,
  withCorrectionKind,
} from "./correction-kind";
import { inference } from "./inference";

export type KindLabeller = (turn: Turn) => Promise<CorrectionKind | null>;

export interface BackfillResult {
  labelled: number;
  failed: number;
}

export function unlabelledCorrections(turns: Turn[]): Turn[] {
  return turns.filter((turn) => turn.confirmed === true && !turn.correctionKind);
}

async function labelWithInference(turn: Turn): Promise<CorrectionKind | null> {
  const request = correctionKindRequest(turn.replyEnd, turn.message, turn.issue);
  const result = await inference(request);
  return result.success ? parseCorrectionKind(result.output) : null;
}

export async function backfillCorrectionKinds(
  label: KindLabeller = labelWithInference,
  onLabelled: (turn: Turn, kind: CorrectionKind | null) => void = () => {}
): Promise<BackfillResult> {
  const replacements = new Map<string, Turn>();
  let failed = 0;
  for (const turn of unlabelledCorrections(readTurns())) {
    const kind = await label(turn);
    onLabelled(turn, kind);
    if (!kind) failed++;
    else replacements.set(turnKey(turn), { ...turn, ...withCorrectionKind(turn, kind) });
  }
  if (replacements.size > 0) replaceTurns(replacements);
  return { labelled: replacements.size, failed };
}

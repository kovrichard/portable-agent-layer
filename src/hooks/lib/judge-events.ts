/**
 * One event per judgment: the mode, the route that answered, and what System One and the fallback each said.
 */

import { appendEvent, logQuietly } from "./events";
import type { JudgeAnswers, JudgeMode, JudgeRoute, SystemOneFailure } from "./judgment";

interface JudgeCallEntry {
  caller: string;
  mode: JudgeMode;
  route: JudgeRoute;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  failure: SystemOneFailure | null;
  systemOneAnswers?: JudgeAnswers;
  fallbackAnswers?: JudgeAnswers;
}

export function logJudgeCall(entry: JudgeCallEntry, sessionId: string | undefined): void {
  logQuietly("judge_call", () =>
    appendEvent("judge_call", { ...entry }, { session: sessionId ?? null })
  );
}

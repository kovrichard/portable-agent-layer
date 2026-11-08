import { isClaude } from "./agent";
import { appendEvent, logQuietly } from "./events";
import { type HookTurnPayload, hookSessionId } from "./hook-turn";
import { contextTokensOf } from "./session-events";
import { isPalSpawnedInference } from "./spawn-guard";

export const COMPACTION_NEAR_THRESHOLD = 200_000;

export function compactionPredicted(
  contextTokens: number,
  thresholdTokens: number = COMPACTION_NEAR_THRESHOLD
): boolean {
  return contextTokens >= thresholdTokens;
}

function windowTokensOf(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const tokens = Number(raw);
  return Number.isFinite(tokens) ? tokens : null;
}

interface PromptTranscriptPayload extends HookTurnPayload {
  transcript_path?: string;
}

export function recordCompactionNear(payload: PromptTranscriptPayload | null): void {
  logQuietly("compaction_near", () => {
    if (!payload || isPalSpawnedInference() || !isClaude()) return;
    const contextTokens = contextTokensOf(payload.transcript_path);
    if (contextTokens === null) return;
    appendEvent(
      "compaction_near",
      {
        mode: "shadow",
        contextTokens,
        thresholdTokens: COMPACTION_NEAR_THRESHOLD,
        windowTokens: windowTokensOf(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW),
        predicted: compactionPredicted(contextTokens),
      },
      { session: hookSessionId(payload) ?? null }
    );
  });
}

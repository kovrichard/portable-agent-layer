import { buildClaudeMd } from "./claude-md";
import { appendEvent, logQuietly } from "./events";
import { type HookTurnPayload, hookSessionId } from "./hook-turn";
import { getSemiStaticSources, readFileSafe } from "./semi-static";

function semiStaticChars(): number {
  return getSemiStaticSources().reduce(
    (sum, source) => sum + readFileSafe(source.path).length,
    0
  );
}

/** Chars, not tokens: no tokenizer runs at session start. */
export function logContextInjected(
  payload: HookTurnPayload | null,
  reminder: string,
  now: Date = new Date()
): void {
  logQuietly("context_injected", () =>
    appendEvent(
      "context_injected",
      {
        instructionsChars: buildClaudeMd().length,
        semiStaticChars: semiStaticChars(),
        dynamicChars: reminder.length,
      },
      { ts: now.toISOString(), session: hookSessionId(payload) ?? null }
    )
  );
}

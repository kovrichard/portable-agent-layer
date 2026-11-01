import { watchReplyRules } from "./adaptation-steering";
import { watchClaims } from "./claim-log";
import { logError } from "./log";
import { rememberSendBack } from "./send-back-guard";
import type { StopTurnPayload } from "./stop";

function skippedOnError(label: string, check: () => string | null): string | null {
  try {
    return check();
  } catch (err) {
    logError(`StopOrchestrator:${label}`, err);
    return null;
  }
}

/** The claim check, then the approved reply rules; the first reason to send the reply back wins. */
export function replySendBack(payload: StopTurnPayload | null): string | null {
  if (!payload) return null;
  const reason =
    skippedOnError("claim-check", () => watchClaims(payload)) ??
    skippedOnError("adaptation-rules", () => watchReplyRules(payload));
  rememberSendBack(payload, reason !== null);
  return reason;
}

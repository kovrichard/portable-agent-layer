import {
  type HookTurnPayload,
  hookFinalReply,
  hookSessionId,
} from "../../core/hook-payload";
import { recordReply } from "./interaction";

export function fileFinalReply(payload: HookTurnPayload | null | undefined): void {
  const sessionId = hookSessionId(payload);
  const reply = hookFinalReply(payload);
  if (sessionId && reply) recordReply(sessionId, reply);
}

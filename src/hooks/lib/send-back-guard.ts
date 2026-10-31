/**
 * One send-back per reply: the stop right after a reply check sent a reply back
 * lets the corrected reply through. A stop held for any other reason, such as an
 * unattended run, leaves the next reply checked again.
 */

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hookSessionId } from "./hook-turn";
import { ensureDir, paths } from "./paths";
import type { StopTurnPayload } from "./stop";

function isContinuedStop(payload: StopTurnPayload): boolean {
  return (
    payload.stop_hook_active === true ||
    (payload.loop_count ?? 0) > 0 ||
    (payload.executionNum ?? 0) > 0
  );
}

function markerOf(session: string): string {
  const dir = ensureDir(resolve(paths.state(), "reply-sent-back"));
  return resolve(dir, session.replace(/[^\w-]/g, "_"));
}

export function alreadySentBack(payload: StopTurnPayload): boolean {
  if (!isContinuedStop(payload)) return false;
  const session = hookSessionId(payload);
  return session ? existsSync(markerOf(session)) : true;
}

export function rememberSendBack(payload: StopTurnPayload, sentBack: boolean): void {
  const session = hookSessionId(payload);
  if (!session) return;
  if (sentBack) writeFileSync(markerOf(session), "");
  else rmSync(markerOf(session), { force: true });
}

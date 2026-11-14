/**
 * Stop handler: desktop notification when Claude finishes responding.
 * Platform dispatch lives in lib/notify — this just chooses the message.
 */

import { basename } from "node:path";
import { notify } from "../../core/notify";
import { identity } from "../../core/settings";
import { readSessionNames } from "../lib/session-names";

export async function notifyDesktop(sessionId?: string): Promise<void> {
  await notify(identity().ai.name, resolveBody(sessionId));
}

function resolveBody(sessionId?: string): string {
  if (sessionId) {
    const name = readSessionNames()[sessionId];
    if (name && name !== "untitled session") return `New message in task "${name}".`;
  }

  const cwd = basename(process.cwd());

  return cwd && cwd !== "/" ? `New message in task "${cwd}".` : "You have a new message.";
}

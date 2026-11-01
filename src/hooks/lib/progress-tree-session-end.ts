/**
 * The session summary's note for whoever picks the work up next becomes the
 * stopped-at of the session's node, unless the session recorded one by hand.
 */

import { appendEvent, readEvents, readTree, scopeOf } from "./progress-tree";
import { openSessionNode } from "./progress-tree-session-node";

export interface SessionStopNote {
  title: string;
  done: string;
  next: string;
  waitingOn: string;
}

function stoppedText(note: SessionStopNote): string {
  const ahead = [
    note.next && `Next: ${note.next}`,
    note.waitingOn && `Waiting on you: ${note.waitingOn}`,
  ].filter(Boolean);
  if (ahead.length) return ahead.join(" · ");
  return note.done ? `Done: ${note.done}` : "";
}

function stoppedByHand(
  node: string,
  session: string | undefined,
  file: string | undefined
): boolean {
  return readEvents(file).some(
    (e) => e.node === node && e.type === "stopped" && !e.auto && e.session === session
  );
}

function sessionNode(
  scope: string,
  session: string | undefined,
  title: string,
  file: string | undefined,
  now: Date
): string {
  return (
    readTree(scope, file, session).active ??
    openSessionNode(scope, session, file, now, title)
  );
}

export function recordWhereSessionStopped(
  cwd: string,
  session: string | undefined,
  note: SessionStopNote,
  file?: string,
  now: Date = new Date()
): void {
  const text = stoppedText(note);
  if (!text) return;
  const scope = scopeOf(cwd);
  const node = sessionNode(scope, session, note.title, file, now);
  if (stoppedByHand(node, session, file)) return;
  appendEvent(scope, node, "stopped", { text, auto: true }, file, now, session);
}

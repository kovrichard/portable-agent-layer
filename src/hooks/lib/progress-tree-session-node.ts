/**
 * A session starts at its project's root, and its first record opens the
 * session's own node there, so a new session never floats and a session
 * that records nothing leaves nothing behind.
 */

import { appendEvent, newNodeId } from "./progress-tree";
import { readSessionNames } from "./session-names";

export function sessionNodeTitle(
  session: string | undefined,
  now: Date = new Date(),
  names: Record<string, string> = readSessionNames(),
  summaryTitle?: string
): string {
  const named = session ? names[session] : undefined;
  return (
    named ?? summaryTitle ?? `Session ${now.toISOString().slice(0, 16).replace("T", " ")}`
  );
}

export function openSessionNode(
  scope: string,
  session: string | undefined,
  file?: string,
  now: Date = new Date(),
  summaryTitle?: string
): string {
  const id = newNodeId(now.getTime());
  appendEvent(
    scope,
    id,
    "open",
    {
      title: sessionNodeTitle(session, now, readSessionNames(), summaryTitle),
      parent: null,
    },
    file,
    now,
    session
  );
  return id;
}

// src/hooks/lib/progress-tree.ts
export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "commit",
  "branch",
  "pr",
  "artifact",
  "file",
  "run",
  "link",
];

export type WorkEvent = EventBase &
  (
    | { type: "open"; title: string; parent: string | null; links?: NodeLinks }
    | { type: "enter" }
    | { type: "park"; stoppedAt?: string }
    | { type: "wait"; on: string }
    | { type: "done"; summary?: string }
    | { type: "stopped"; text: string }
    | { type: "decide"; text: string; why?: string }
    | { type: "attach"; kind: ArtifactKind; ref: string; label?: string }
    | { type: "follow-up"; text: string; due?: string }
    | { type: "git-cursor"; branch: string; head: string }
    | {
        type: "pr-settled";
        ref: string;
        state: "merged" | "closed";
        at: string;
        stoppedAt?: string;
      }
  );

export function appendEvent<T extends WorkEvent["type"]>(
  scope: string,
  node: string,
  type: T,
  payload: Payload<T>,
  file: string = progressTreeFile(),
  now: Date = new Date(),
  session: string | undefined = progressSession()
): WorkEvent {
  const event = {
    id: newNodeId(now.getTime()),
    ts: now.toISOString(),
    scope,
    node,
    ...(session && { session }),
    type,
    ...payload,
  } as WorkEvent;
  appendFileSync(file, `${JSON.stringify(event)}\n`, "utf-8");
  return event;
}

// src/hooks/lib/progress-tree-session-node.ts
import { appendEvent, newNodeId } from "./progress-tree";
import { readSessionNames } from "./session-names";

export function sessionNodeTitle(
  session: string | undefined,
  now: Date = new Date(),
  names: Record<string, string> = readSessionNames()
): string {
  const named = session ? names[session] : undefined;
  return named ?? `Session ${now.toISOString().slice(0, 16).replace("T", " ")}`;
}

export function openSessionNode(
  scope: string,
  session: string | undefined,
  file?: string,
  now: Date = new Date()
): string {
  const id = newNodeId(now.getTime());
  appendEvent(
    scope,
    id,
    "open",
    { title: sessionNodeTitle(session, now), parent: null },
    file,
    now,
    session
  );
  return id;
}

// src/hooks/lib/progress-tree-git.ts
function attachMoves({ scope, node, branch, commits, file, now }: GitMoves): void {
  if (branch)
    appendEvent(scope, node, "attach", { kind: "branch", ref: branch }, file, now);
  for (const commit of commits)
    appendEvent(
      scope,
      node,
      "attach",
      { kind: "commit", ref: commit.sha, label: commit.subject },
      file,
      now
    );
}

export function attachGitProgress(
  cwd: string,
  file?: string,
  now: Date = new Date(),
  session: string | undefined = progressSession()
): void {
  const scope = scopeOf(cwd);
  const tree = readTree(scope, file, session);
  if (tree.nodes.size === 0) return;
  const current = snapshot(cwd);
  if (!current) return;
  const cursor = tree.gitCursor;
  if (cursor?.head === current.head && cursor.branch === current.branch) return;

  if (cursor) {
    const branch = cursor.branch !== current.branch ? current.branch : null;
    const commits = ownCommitsSince(cwd, cursor.head, current.head, current.email);
    const node =
      tree.active ??
      (commits.length > 0 ? openSessionNode(scope, session, file, now) : null);
    if (node) attachMoves({ scope, node, branch, commits, file, now });
  }
  appendEvent(
    scope,
    "",
    "git-cursor",
    { branch: current.branch, head: current.head },
    file,
    now
  );
}

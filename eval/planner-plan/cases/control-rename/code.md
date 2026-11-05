// src/cli/work.ts
/**
 * pal cli work — the work tree: what is active, what is parked and where it
 * stopped, the decisions and artifacts of each piece of work.
 */

import { workSession } from "../hooks/lib/work-session";
import {
  ARTIFACT_KINDS,
  type ArtifactKind,
  appendEvent,
  findNode,
  newNodeId,
  readTree,
  type ScopeTree,
  scopeOf,
  type WorkNode,
} from "../hooks/lib/work-tree";
import {
  renderNodeDetail,
  renderSessionContext,
  renderTreeList,
  suffix,
} from "../hooks/lib/work-tree-render";
import { openSessionNode } from "../hooks/lib/work-tree-session-node";
import { group, leaf, runCommand, UsageError } from "../tools/lib/command";

const SCOPE = {
  type: "string",
  description: "Project or folder the work belongs to (default: the current one)",
} as const;
const NODE = {
  type: "string",
  description: "Node id or unambiguous prefix (default: the active node)",
} as const;

class NodeError extends Error {}

function scopeFrom(values: { scope?: string }): string {
  return values.scope ?? scopeOf(process.cwd());
}

function requireText(text: string | undefined, what: string): string {
  if (!text?.trim()) throw new UsageError(`${what} is required`);
  return text.trim();
}

function targetNode(tree: ScopeTree, idOrPrefix: string | undefined): WorkNode {
  if (idOrPrefix) {
    const node = findNode(tree, idOrPrefix);
    if (!node)
      throw new NodeError(`No single node matches "${idOrPrefix}" in ${tree.scope}`);
    return node;
  }
  const active = tree.active ? tree.nodes.get(tree.active) : undefined;
  if (!active)
    throw new NodeError(
      `No active node in ${tree.scope}; pass --node, or open or enter one first`
    );
  return active;
}

function guarded(run: () => void): number {
  try {
    run();
    return 0;
  } catch (err) {
    if (!(err instanceof NodeError)) throw err;
    console.error(err.message);
    return 1;
  }
}

// call site: the record helper every "stopped", "decide", "attach" and "follow-up" leaf uses
function record<T extends Parameters<typeof appendEvent>[2]>(
  values: { scope?: string; node?: string },
  type: T,
  payload: Parameters<typeof appendEvent<T>>[3],
  done: (node: WorkNode) => string,
  fromRoot = false
): number {
  return guarded(() => {
    const scope = scopeFrom(values);
    const node = fromRoot
      ? nodeToRecordOn(scope, values.node)
      : targetNode(readTree(scope), values.node);
    appendEvent(scope, node.id, type, payload);
    console.log(done(node));
  });
}

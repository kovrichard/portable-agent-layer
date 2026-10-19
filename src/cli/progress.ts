/**
 * pal cli progress — the progress tree: what is active, what is parked and where it
 * stopped, the decisions and artifacts of each piece of work.
 */

import { progressSession } from "../hooks/lib/progress-session";
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
} from "../hooks/lib/progress-tree";
import {
  renderNodeDetail,
  renderSessionContext,
  renderTreeList,
  suffix,
} from "../hooks/lib/progress-tree-render";
import { openSessionNode } from "../hooks/lib/progress-tree-session-node";
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

function nodeToRecordOn(scope: string, idOrPrefix: string | undefined): WorkNode {
  const tree = readTree(scope);
  if (idOrPrefix || tree.active) return targetNode(tree, idOrPrefix);
  const id = openSessionNode(scope, progressSession());
  return targetNode(readTree(scope), id);
}

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

function parentFor(tree: ScopeTree, under: string | undefined, root: boolean) {
  if (root) return null;
  if (under) return targetNode(tree, under).id;
  return tree.active;
}

function optionalIsc(isc: string | undefined): number | undefined {
  if (isc === undefined) return undefined;
  const parsed = Number(isc);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new UsageError(`--isc must be an ISC number, got "${isc}"`);
  return parsed;
}

function cmdOpen(
  title: string | undefined,
  values: {
    scope?: string;
    under?: string;
    root?: boolean;
    isc?: string;
    commitment?: string;
  }
): number {
  const text = requireText(title, "A title");
  const isc = optionalIsc(values.isc);
  return guarded(() => {
    const scope = scopeFrom(values);
    const tree = readTree(scope);
    const parent = parentFor(tree, values.under, values.root === true);
    const id = newNodeId();
    const links = {
      ...(isc !== undefined && { isc }),
      ...(values.commitment && { commitment: values.commitment }),
    };
    appendEvent(scope, id, "open", { title: text, parent, links });
    const under = parent ? ` under ${tree.nodes.get(parent)?.title ?? parent}` : "";
    console.log(`Opened ${text} [${id}]${under}; it is now active.`);
  });
}

function backTo(scope: string): string {
  const tree = readTree(scope);
  const active = tree.active ? tree.nodes.get(tree.active) : undefined;
  if (!active) return "No node is active now.";
  return `Back to ${active.title} [${active.id}]${suffix(", stopped at: ", active.stoppedAt)}.`;
}

function cmdDone(values: { scope?: string; node?: string; summary?: string }): number {
  return guarded(() => {
    const scope = scopeFrom(values);
    const node = targetNode(readTree(scope), values.node);
    appendEvent(
      scope,
      node.id,
      "done",
      values.summary ? { summary: values.summary } : {}
    );
    console.log(`Done: ${node.title} [${node.id}]. ${backTo(scope)}`);
  });
}

function artifactKind(kind: string | undefined): ArtifactKind {
  if (kind && (ARTIFACT_KINDS as readonly string[]).includes(kind))
    return kind as ArtifactKind;
  throw new UsageError(
    `kind must be one of ${ARTIFACT_KINDS.join(", ")}, got "${kind ?? ""}"`
  );
}

function cmdShow(values: { scope?: string; node?: string; json?: boolean }): number {
  return guarded(() => {
    const tree = readTree(scopeFrom(values));
    if (!values.node && !tree.active) {
      console.log(
        renderSessionContext(tree) || `No work recorded for ${tree.scope} yet.`
      );
      return;
    }
    const node = targetNode(tree, values.node);
    console.log(
      values.json ? JSON.stringify(node, null, 2) : renderNodeDetail(tree, node)
    );
  });
}

function cmdList(values: { scope?: string; all?: boolean; json?: boolean }): number {
  const tree = readTree(scopeFrom(values));
  if (values.json) {
    console.log(JSON.stringify({ ...tree, nodes: [...tree.nodes.values()] }, null, 2));
    return 0;
  }
  console.log(renderTreeList(tree, values.all === true));
  return 0;
}

export const progressCommand = group({
  summary:
    "The progress tree: what is active, parked, waiting, and where each piece stopped",
  fallback: "show",
  commands: {
    show: leaf({
      summary: "The active node in full, or the whole picture when none is active",
      options: {
        scope: SCOPE,
        node: NODE,
        json: { type: "boolean", description: "As JSON" },
      },
      run: ({ values }) => cmdShow(values),
    }),
    list: leaf({
      summary: "Every open node as a tree",
      options: {
        scope: SCOPE,
        all: { type: "boolean", description: "Include finished nodes" },
        json: { type: "boolean", description: "As JSON" },
      },
      run: ({ values }) => cmdList(values),
    }),
    open: leaf({
      summary: "Open a node and make it active (a child of the active node by default)",
      args: "<title...>",
      options: {
        scope: SCOPE,
        under: { type: "string", description: "Parent node id or prefix" },
        root: {
          type: "boolean",
          description: "Open at the top level, not under the active node",
        },
        isc: { type: "string", description: "The project ISC this node works on" },
        commitment: {
          type: "string",
          description: "The commitment id this node fulfils",
        },
      },
      run: ({ positionals, values }) => cmdOpen(positionals.join(" "), values),
    }),
    enter: leaf({
      summary: "Make a node active, parking the one that was",
      args: "<node>",
      options: { scope: SCOPE },
      run: ({ positionals, values }) =>
        record(
          { ...values, node: requireText(positionals[0], "A node") },
          "enter",
          {},
          (n) => `Entered ${n.title} [${n.id}]${suffix(", stopped at: ", n.stoppedAt)}.`
        ),
    }),
    park: leaf({
      summary: "Park a node, saying where it stopped",
      options: {
        scope: SCOPE,
        node: NODE,
        stopped: { type: "string", description: "Where it stopped, to resume from" },
      },
      run: ({ values }) =>
        record(
          values,
          "park",
          values.stopped ? { stoppedAt: values.stopped } : {},
          (n) => `Parked ${n.title} [${n.id}].`
        ),
    }),
    wait: leaf({
      summary: "Mark a node as waiting on the user",
      args: "<waits-on...>",
      options: { scope: SCOPE, node: NODE },
      run: ({ positionals, values }) =>
        record(
          values,
          "wait",
          { on: requireText(positionals.join(" "), "What it waits on") },
          (n) => `${n.title} [${n.id}] is waiting on the user.`
        ),
    }),
    done: leaf({
      summary: "Finish a node; a finished detour hands the work back to its parent",
      options: {
        scope: SCOPE,
        node: NODE,
        summary: { type: "string", description: "One line on what it ended with" },
      },
      run: ({ values }) => cmdDone(values),
    }),
    stopped: leaf({
      summary: "Record where the work stands now",
      args: "<text...>",
      options: { scope: SCOPE, node: NODE },
      run: ({ positionals, values }) =>
        record(
          values,
          "stopped",
          { text: requireText(positionals.join(" "), "Where it stopped") },
          (n) => `Stopped-at recorded on ${n.title} [${n.id}].`,
          true
        ),
    }),
    decide: leaf({
      summary: "Record a decision on a node",
      args: "<decision...>",
      options: {
        scope: SCOPE,
        node: NODE,
        why: { type: "string", description: "The reason" },
      },
      run: ({ positionals, values }) =>
        record(
          values,
          "decide",
          {
            text: requireText(positionals.join(" "), "A decision"),
            ...(values.why && { why: values.why }),
          },
          (n) => `Decision recorded on ${n.title} [${n.id}].`,
          true
        ),
    }),
    attach: leaf({
      summary: `Attach an artifact to a node (${ARTIFACT_KINDS.join(", ")})`,
      args: "<kind> <ref...>",
      options: {
        scope: SCOPE,
        node: NODE,
        label: { type: "string", description: "What it is" },
      },
      run: ({ positionals, values }) =>
        record(
          values,
          "attach",
          {
            kind: artifactKind(positionals[0]),
            ref: requireText(positionals.slice(1).join(" "), "A ref"),
            ...(values.label && { label: values.label }),
          },
          (n) => `Attached to ${n.title} [${n.id}].`,
          true
        ),
    }),
    "follow-up": leaf({
      summary: "Record a follow-up on a node",
      args: "<text...>",
      options: {
        scope: SCOPE,
        node: NODE,
        due: { type: "string", description: "When it is due, such as 2026-10-25" },
      },
      run: ({ positionals, values }) =>
        record(
          values,
          "follow-up",
          {
            text: requireText(positionals.join(" "), "A follow-up"),
            ...(values.due && { due: values.due }),
          },
          (n) => `Follow-up recorded on ${n.title} [${n.id}].`,
          true
        ),
    }),
  },
});

export function runProgress(args: string[]): Promise<number> {
  return runCommand(progressCommand, args, ["pal", "cli", "progress"]);
}

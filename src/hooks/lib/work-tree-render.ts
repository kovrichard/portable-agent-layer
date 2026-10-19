/**
 * How the work tree reads as text: the CLI's views, the block a new or
 * compacted session starts with, and the one line every prompt carries.
 */

import {
  activeElsewhere,
  activePath,
  nodesWithStatus,
  type ScopeTree,
  type WorkNode,
} from "./work-tree";

const SESSION_BUDGET = 2_000;
const RECENT_DECISIONS = 3;
const LISTED_PARKED = 5;
const PROMPT_LINE_MAX = 300;

const RECORD_HINT =
  "Record as you go: pal cli work stopped|decide|attach|follow-up|open|done (pal cli work --help)";

export function suffix(
  lead: string,
  value: string | null | undefined,
  tail = ""
): string {
  return value ? `${lead}${value}${tail}` : "";
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function label(node: WorkNode): string {
  return `${node.title} [${node.id}]`;
}

function stoppedClause(node: WorkNode): string {
  return node.stoppedAt
    ? ` — stopped at: ${node.stoppedAt}`
    : " — no stopped-at recorded";
}

function due(followUp: { due?: string }): string {
  return followUp.due ? ` (due ${followUp.due.slice(0, 10)})` : "";
}

export function renderNodeDetail(tree: ScopeTree, node: WorkNode): string {
  const path = activePath({ ...tree, active: node.id })
    .map((n) => n.title)
    .join(" › ");
  const lines = [
    `${label(node)} — ${node.status}`,
    `Path: ${path}`,
    `Stopped at: ${node.stoppedAt ?? "(not recorded)"}`,
  ];
  if (node.waitingOn) lines.push(`Waiting on: ${node.waitingOn}`);
  if (node.summary) lines.push(`Summary: ${node.summary}`);
  if (node.links.isc !== undefined) lines.push(`ISC: ${node.links.isc}`);
  if (node.links.commitment) lines.push(`Commitment: ${node.links.commitment}`);
  const section = (title: string, rows: string[]) => {
    if (rows.length) lines.push(`${title}:`, ...rows.map((r) => `  - ${r}`));
  };
  section(
    "Decisions",
    node.decisions.map(
      (d) => `${d.ts.slice(0, 10)} ${d.text}${suffix(" (why: ", d.why, ")")}`
    )
  );
  section(
    "Artifacts",
    node.artifacts.map((a) => `${a.kind} ${a.ref}${suffix(" — ", a.label)}`)
  );
  section(
    "Follow-ups",
    node.followUps.map((f) => `${f.text}${due(f)}`)
  );
  return lines.join("\n");
}

function childrenOf(tree: ScopeTree, parent: string | null): WorkNode[] {
  return [...tree.nodes.values()]
    .filter(
      (n) => n.parent === parent || (parent === null && !tree.nodes.has(n.parent ?? ""))
    )
    .sort((a, b) => a.opened.localeCompare(b.opened));
}

const MARK: Record<WorkNode["status"], string> = {
  active: "▶",
  parked: "‖",
  waiting: "?",
  done: "✓",
};

export function renderTreeList(tree: ScopeTree, includeDone: boolean): string {
  const lines: string[] = [];
  const walk = (node: WorkNode, depth: number) => {
    if (node.status === "done" && !includeDone) return;
    const stop = node.status === "done" ? "" : stoppedClause(node);
    lines.push(`${"  ".repeat(depth)}${MARK[node.status]} ${label(node)}${stop}`);
    for (const child of childrenOf(tree, node.id)) walk(child, depth + 1);
  };
  for (const root of childrenOf(tree, null)) walk(root, 0);
  return lines.length ? lines.join("\n") : `No work recorded for ${tree.scope} yet.`;
}

function activeSection(tree: ScopeTree): string[] {
  const path = activePath(tree);
  const active = path.at(-1);
  if (!active) return ["Active: none in this session — enter a node below or open one."];
  const lines = [`Active: ${label(active)}${stoppedClause(active)}`];
  if (path.length > 1) lines.push(`  Inside: ${path.map((n) => n.title).join(" › ")}`);
  for (const d of active.decisions.slice(-RECENT_DECISIONS))
    lines.push(`  Decided ${d.ts.slice(0, 10)}: ${d.text}`);
  return lines;
}

function listSection(title: string, rows: string[]): string[] {
  return rows.length ? [title, ...rows.map((r) => `- ${r}`)] : [];
}

/** What a new or compacted session needs to pick the work back up without digging. */
export function renderSessionContext(tree: ScopeTree): string {
  if (tree.nodes.size === 0) return "";
  const nodes = [...tree.nodes.values()];
  const open = nodes.filter((n) => n.status !== "done");
  const lines = [
    `## Work tree — ${tree.scope}`,
    ...activeSection(tree),
    ...listSection(
      "Active in other sessions:",
      activeElsewhere(tree).map((n) => `${label(n)}${stoppedClause(n)}`)
    ),
    ...listSection(
      "Waiting on the user:",
      nodesWithStatus(tree, "waiting").map((n) => `${label(n)}: ${n.waitingOn}`)
    ),
    ...listSection(
      "Parked:",
      nodesWithStatus(tree, "parked")
        .slice(0, LISTED_PARKED)
        .map((n) => `${label(n)}${stoppedClause(n)}`)
    ),
    ...listSection(
      "Follow-ups:",
      open.flatMap((n) => n.followUps.map((f) => `${f.text}${due(f)} — on ${n.title}`))
    ),
    RECORD_HINT,
  ];
  return clip(lines.join("\n"), SESSION_BUDGET);
}

const NEW_TOPIC_HINT =
  'New topic: if this is separate work, park the active node with its stopped-at (pal cli work park --stopped "…") and open one for this (pal cli work open "…").';

/** The line every prompt carries, so the active node survives anything that drops context. */
export function renderPromptLine(tree: ScopeTree, newTopic: boolean): string | null {
  if (tree.nodes.size === 0) return null;
  const active = tree.active ? tree.nodes.get(tree.active) : undefined;
  const parked = nodesWithStatus(tree, "parked").length;
  const elsewhere = activeElsewhere(tree).length;
  const head = active
    ? `Work: ${label(active)}${stoppedClause(active)}`
    : "Work: no active node in this session";
  const tail = elsewhere ? ` · ${elsewhere} active in other sessions` : "";
  const line = clip(`${head} · ${parked} parked${tail}`, PROMPT_LINE_MAX);
  return newTopic ? `${line}\n${NEW_TOPIC_HINT}` : line;
}

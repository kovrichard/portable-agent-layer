/**
 * How the progress tree reads as text: the CLI's views, the block a new or
 * compacted session starts with, and the one line every prompt carries.
 */

import {
  activeElsewhere,
  activePath,
  idleElsewhere,
  nodesWithStatus,
  type ScopeTree,
  type WorkNode,
} from "./progress-tree";
import { mergedButOpen, recentlyFinished } from "./progress-tree-tidy";

const SESSION_BUDGET = 2_000;
const RECENT_DECISIONS = 3;
const LISTED_PARKED = 5;
const LISTED_FINISHED = 3;
const PROMPT_LINE_MAX = 300;

const RECORD_HINT =
  "Record as you go: pal cli progress stopped|decide|attach|follow-up|open|done (pal cli progress --help)";

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
  const path = [
    tree.scope,
    ...activePath({ ...tree, active: node.id }).map((n) => n.title),
  ].join(" › ");
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

function parentIn(tree: ScopeTree, node: WorkNode): string {
  return node.parent && tree.nodes.has(node.parent) ? node.parent : tree.root.id;
}

function childrenOf(tree: ScopeTree, parent: string): WorkNode[] {
  return [...tree.nodes.values()]
    .filter((n) => parentIn(tree, n) === parent)
    .sort((a, b) => a.opened.localeCompare(b.opened));
}

const MARK: Record<WorkNode["status"], string> = {
  active: "▶",
  parked: "‖",
  waiting: "?",
  done: "✓",
};

const MERGED_MARK = "✓?";

function idleClause(since: string): string {
  return ` (idle since ${since.slice(0, 10)})`;
}

function idleSinceById(tree: ScopeTree, now: Date): Map<string, string> {
  return new Map(idleElsewhere(tree, now).map(({ node, since }) => [node.id, since]));
}

export function renderTreeList(
  tree: ScopeTree,
  includeDone: boolean,
  now: Date = new Date()
): string {
  const idle = idleSinceById(tree, now);
  const merged = new Set(mergedButOpen(tree).map(({ node }) => node.id));
  const markOf = (node: WorkNode) => {
    if (merged.has(node.id)) return MERGED_MARK;
    return idle.has(node.id) ? MARK.parked : MARK[node.status];
  };
  const lines: string[] = [];
  const walk = (node: WorkNode, depth: number) => {
    if (node.status === "done" && !includeDone) return;
    const since = idle.get(node.id);
    const stop = node.status === "done" ? "" : stoppedClause(node);
    lines.push(
      `${"  ".repeat(depth)}${markOf(node)} ${label(node)}${since ? idleClause(since) : ""}${stop}`
    );
    for (const child of childrenOf(tree, node.id)) walk(child, depth + 1);
  };
  for (const top of childrenOf(tree, tree.root.id)) walk(top, 1);
  return lines.length
    ? [`◆ ${tree.root.title}`, ...lines].join("\n")
    : `No work recorded for ${tree.scope} yet.`;
}

function activeSection(tree: ScopeTree): string[] {
  const path = activePath(tree);
  const active = path.at(-1);
  if (!active)
    return [
      `Active: the project root (${tree.scope}) — this session's first stopped/decide/attach opens its node here; to continue earlier work, enter a node below.`,
    ];
  const lines = [`Active: ${label(active)}${stoppedClause(active)}`];
  if (path.length > 1) lines.push(`  Inside: ${path.map((n) => n.title).join(" › ")}`);
  for (const d of active.decisions.slice(-RECENT_DECISIONS))
    lines.push(`  Decided ${d.ts.slice(0, 10)}: ${d.text}`);
  return lines;
}

function listSection(title: string, rows: string[]): string[] {
  return rows.length ? [title, ...rows.map((r) => `- ${r}`)] : [];
}

function prNumber(ref: string): string {
  const digits = /(\d+)$/.exec(ref)?.[1];
  return digits ? `#${digits}` : ref;
}

function mergedRows(tree: ScopeTree): string[] {
  return mergedButOpen(tree).map(
    ({ node, lastMerge }) =>
      `${label(node)} — ${prNumber(lastMerge.ref)} merged ${lastMerge.at.slice(0, 10)}; close with pal cli progress done --node ${node.id}`
  );
}

function touchedClause(updated: string): string {
  return ` (touched ${updated.slice(0, 10)})`;
}

function parkedNodes(tree: ScopeTree, now: Date): WorkNode[] {
  const held = [...idleSinceById(tree, now).keys()].flatMap(
    (id) => tree.nodes.get(id) ?? []
  );
  const listedAsDone = new Set(mergedButOpen(tree).map(({ node }) => node.id));
  return [...nodesWithStatus(tree, "parked"), ...held].filter(
    (n) => !listedAsDone.has(n.id)
  );
}

function parkedRows(tree: ScopeTree, now: Date): string[] {
  const idle = idleSinceById(tree, now);
  return parkedNodes(tree, now)
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, LISTED_PARKED)
    .map((n) => {
      const since = idle.get(n.id);
      return `${label(n)}${since ? idleClause(since) : touchedClause(n.updated)}${stoppedClause(n)}`;
    });
}

function finishedRows(tree: ScopeTree, now: Date): string[] {
  return recentlyFinished(tree, now)
    .slice(0, LISTED_FINISHED)
    .map((n) => `${label(n)}${suffix(" — ", n.summary)}`);
}

/** What a new or compacted session needs to pick the work back up without digging. */
export function renderSessionContext(tree: ScopeTree, now: Date = new Date()): string {
  if (tree.nodes.size === 0) return "";
  const nodes = [...tree.nodes.values()];
  const open = nodes.filter((n) => n.status !== "done");
  const lines = [
    `## Progress tree — ${tree.scope}`,
    ...activeSection(tree),
    ...listSection(
      "Active in other sessions:",
      activeElsewhere(tree, now).map((n) => `${label(n)}${stoppedClause(n)}`)
    ),
    ...listSection("Done? (every PR merged, nothing recorded since):", mergedRows(tree)),
    ...listSection(
      "Waiting on the user:",
      nodesWithStatus(tree, "waiting").map((n) => `${label(n)}: ${n.waitingOn}`)
    ),
    ...listSection("Parked:", parkedRows(tree, now)),
    ...listSection("Finished lately (enter one to reopen it):", finishedRows(tree, now)),
    ...listSection(
      "Follow-ups:",
      open.flatMap((n) => n.followUps.map((f) => `${f.text}${due(f)} — on ${n.title}`))
    ),
    RECORD_HINT,
  ];
  return clip(lines.join("\n"), SESSION_BUDGET);
}

const NEW_TOPIC_HINT =
  'New topic: if this is separate work, park the active node with its stopped-at (pal cli progress park --stopped "…") and open one for this (pal cli progress open "…").';

/** The line every prompt carries, so the active node survives anything that drops context. */
export function renderPromptLine(
  tree: ScopeTree,
  newTopic: boolean,
  now: Date = new Date()
): string | null {
  if (tree.nodes.size === 0) return null;
  const active = tree.active ? tree.nodes.get(tree.active) : undefined;
  const parked = parkedNodes(tree, now).length;
  const elsewhere = activeElsewhere(tree, now).length;
  const head = active
    ? `Progress: ${label(active)}${stoppedClause(active)}`
    : `Progress: ${tree.scope} root — this session has no node yet`;
  const tail = elsewhere ? ` · ${elsewhere} active in other sessions` : "";
  const line = clip(`${head} · ${parked} parked${tail}`, PROMPT_LINE_MAX);
  return newTopic ? `${line}\n${NEW_TOPIC_HINT}` : line;
}

/**
 * The work tree: what the user is working on, what is parked and where each
 * piece of work stopped, kept as an append-only event log so a compaction, a
 * new session or a detour never loses it. The tree is derived on every read;
 * nothing but the events is stored.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "./paths";
import { readAllProjects, resolveProjectFromCwd } from "./projects";

export type NodeStatus = "active" | "parked" | "waiting" | "done";

export type ArtifactKind =
  | "commit"
  | "branch"
  | "pr"
  | "artifact"
  | "file"
  | "run"
  | "link";

export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "commit",
  "branch",
  "pr",
  "artifact",
  "file",
  "run",
  "link",
];

interface NodeLinks {
  isc?: number;
  commitment?: string;
}

interface EventBase {
  id: string;
  ts: string;
  scope: string;
  node: string;
}

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
  );

type Payload<T extends WorkEvent["type"]> = Omit<
  Extract<WorkEvent, { type: T }>,
  keyof EventBase | "type"
>;

interface Decision {
  ts: string;
  text: string;
  why?: string;
}

interface Artifact {
  ts: string;
  kind: ArtifactKind;
  ref: string;
  label?: string;
}

interface FollowUp {
  ts: string;
  text: string;
  due?: string;
}

export interface WorkNode {
  id: string;
  title: string;
  parent: string | null;
  status: NodeStatus;
  stoppedAt: string | null;
  waitingOn: string | null;
  summary: string | null;
  decisions: Decision[];
  artifacts: Artifact[];
  followUps: FollowUp[];
  links: NodeLinks;
  opened: string;
  updated: string;
}

interface GitCursor {
  branch: string;
  head: string;
}

export interface ScopeTree {
  scope: string;
  active: string | null;
  nodes: Map<string, WorkNode>;
  gitCursor: GitCursor | null;
}

function workTreeFile(): string {
  return resolve(ensureDir(resolve(paths.memory(), "work-tree")), "events.jsonl");
}

/** A registered project is its own scope wherever in it the agent stands; anything else is its folder. */
export function scopeOf(cwd: string): string {
  return resolveProjectFromCwd(cwd, readAllProjects())?.name ?? resolve(cwd);
}

export function newNodeId(
  now: number = Date.now(),
  random: () => number = Math.random
): string {
  return now.toString(36).slice(-5) + random().toString(36).slice(2, 5);
}

function parseLine(line: string): WorkEvent[] {
  try {
    return [JSON.parse(line) as WorkEvent];
  } catch {
    return [];
  }
}

/** Ordered by time, so the union an import merges in replays the same as one machine's log. */
export function readEvents(file: string = workTreeFile()): WorkEvent[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap(parseLine)
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export function appendEvent<T extends WorkEvent["type"]>(
  scope: string,
  node: string,
  type: T,
  payload: Payload<T>,
  file: string = workTreeFile(),
  now: Date = new Date()
): WorkEvent {
  const event = {
    id: newNodeId(now.getTime()),
    ts: now.toISOString(),
    scope,
    node,
    type,
    ...payload,
  } as WorkEvent;
  appendFileSync(file, `${JSON.stringify(event)}\n`, "utf-8");
  return event;
}

function emptyNode(
  id: string,
  title: string,
  parent: string | null,
  ts: string
): WorkNode {
  return {
    id,
    title,
    parent,
    status: "active",
    stoppedAt: null,
    waitingOn: null,
    summary: null,
    decisions: [],
    artifacts: [],
    followUps: [],
    links: {},
    opened: ts,
    updated: ts,
  };
}

function parkActive(tree: ScopeTree): void {
  const current = tree.active ? tree.nodes.get(tree.active) : undefined;
  if (current?.status === "active") current.status = "parked";
  tree.active = null;
}

function activate(tree: ScopeTree, node: WorkNode): void {
  if (tree.active !== node.id) parkActive(tree);
  node.status = "active";
  node.waitingOn = null;
  tree.active = node.id;
}

/** Finishing a detour hands the work back to the nearest unfinished ancestor. */
function returnToParent(tree: ScopeTree, node: WorkNode): void {
  let parent = node.parent ? tree.nodes.get(node.parent) : undefined;
  while (parent && parent.status === "done")
    parent = parent.parent ? tree.nodes.get(parent.parent) : undefined;
  if (parent) activate(tree, parent);
}

function applyToNode(tree: ScopeTree, node: WorkNode, event: WorkEvent): void {
  switch (event.type) {
    case "enter":
      activate(tree, node);
      break;
    case "park":
      if (event.stoppedAt) node.stoppedAt = event.stoppedAt;
      node.status = "parked";
      if (tree.active === node.id) tree.active = null;
      break;
    case "wait":
      node.status = "waiting";
      node.waitingOn = event.on;
      if (tree.active === node.id) tree.active = null;
      break;
    case "done": {
      const wasActive = tree.active === node.id;
      node.status = "done";
      node.summary = event.summary ?? node.summary;
      if (wasActive) {
        tree.active = null;
        returnToParent(tree, node);
      }
      break;
    }
    case "stopped":
      node.stoppedAt = event.text;
      break;
    case "decide":
      node.decisions.push({ ts: event.ts, text: event.text, why: event.why });
      break;
    case "attach":
      node.artifacts.push({
        ts: event.ts,
        kind: event.kind,
        ref: event.ref,
        label: event.label,
      });
      break;
    case "follow-up":
      node.followUps.push({ ts: event.ts, text: event.text, due: event.due });
      break;
  }
  node.updated = event.ts;
}

function apply(tree: ScopeTree, event: WorkEvent): void {
  if (event.type === "git-cursor") {
    tree.gitCursor = { branch: event.branch, head: event.head };
    return;
  }
  if (event.type === "open") {
    const node = emptyNode(event.node, event.title, event.parent, event.ts);
    node.links = event.links ?? {};
    tree.nodes.set(node.id, node);
    activate(tree, node);
    return;
  }
  const node = tree.nodes.get(event.node);
  if (node) applyToNode(tree, node, event);
}

export function buildTree(scope: string, events: WorkEvent[]): ScopeTree {
  const tree: ScopeTree = { scope, active: null, nodes: new Map(), gitCursor: null };
  for (const event of events) if (event.scope === scope) apply(tree, event);
  return tree;
}

export function readTree(scope: string, file: string = workTreeFile()): ScopeTree {
  return buildTree(scope, readEvents(file));
}

/** From the root down to the active node: the detours the user is inside of. */
export function activePath(tree: ScopeTree): WorkNode[] {
  const path: WorkNode[] = [];
  let node = tree.active ? tree.nodes.get(tree.active) : undefined;
  while (node) {
    path.unshift(node);
    node = node.parent ? tree.nodes.get(node.parent) : undefined;
  }
  return path;
}

function byRecent(a: WorkNode, b: WorkNode): number {
  return b.updated.localeCompare(a.updated);
}

export function nodesWithStatus(tree: ScopeTree, status: NodeStatus): WorkNode[] {
  return [...tree.nodes.values()].filter((n) => n.status === status).sort(byRecent);
}

/** An id, or any unambiguous prefix of one. */
export function findNode(tree: ScopeTree, idOrPrefix: string): WorkNode | null {
  const exact = tree.nodes.get(idOrPrefix);
  if (exact) return exact;
  const matches = [...tree.nodes.values()].filter((n) => n.id.startsWith(idOrPrefix));
  return matches.length === 1 ? matches[0] : null;
}

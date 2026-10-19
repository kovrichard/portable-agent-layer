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
import { workSession } from "./work-session";

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
  session?: string;
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

/** `active` is the viewing session's node; `lanes` holds every session's, keyed by session ("" for none). */
export interface ScopeTree {
  scope: string;
  active: string | null;
  lanes: Map<string, string>;
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
  now: Date = new Date(),
  session: string | undefined = workSession()
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

function laneOf(event: WorkEvent): string {
  return event.session ?? "";
}

function parkLane(tree: ScopeTree, lane: string): void {
  const current = tree.nodes.get(tree.lanes.get(lane) ?? "");
  if (current?.status === "active") current.status = "parked";
  tree.lanes.delete(lane);
}

/** The lane that held the node, if one did. */
function release(tree: ScopeTree, node: WorkNode): string | undefined {
  const held = [...tree.lanes].find(([, id]) => id === node.id)?.[0];
  if (held !== undefined) tree.lanes.delete(held);
  return held;
}

/** A node is active in one session at a time, so entering it takes it over. */
function activate(tree: ScopeTree, node: WorkNode, lane: string): void {
  if (tree.lanes.get(lane) !== node.id) parkLane(tree, lane);
  release(tree, node);
  node.status = "active";
  node.waitingOn = null;
  tree.lanes.set(lane, node.id);
}

function heldElsewhere(tree: ScopeTree, node: WorkNode): boolean {
  return [...tree.lanes.values()].includes(node.id);
}

/** Finishing a detour hands the work back to the nearest unfinished ancestor no other session holds. */
function returnToParent(tree: ScopeTree, node: WorkNode, lane: string): void {
  let parent = node.parent ? tree.nodes.get(node.parent) : undefined;
  while (parent && parent.status === "done")
    parent = parent.parent ? tree.nodes.get(parent.parent) : undefined;
  if (parent && !heldElsewhere(tree, parent)) activate(tree, parent, lane);
}

function applyToNode(tree: ScopeTree, node: WorkNode, event: WorkEvent): void {
  switch (event.type) {
    case "enter":
      activate(tree, node, laneOf(event));
      break;
    case "park":
      if (event.stoppedAt) node.stoppedAt = event.stoppedAt;
      node.status = "parked";
      release(tree, node);
      break;
    case "wait":
      node.status = "waiting";
      node.waitingOn = event.on;
      release(tree, node);
      break;
    case "done": {
      node.status = "done";
      node.summary = event.summary ?? node.summary;
      const lane = release(tree, node);
      if (lane !== undefined) returnToParent(tree, node, lane);
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
    activate(tree, node, laneOf(event));
    return;
  }
  const node = tree.nodes.get(event.node);
  if (node) applyToNode(tree, node, event);
}

export function buildTree(
  scope: string,
  events: WorkEvent[],
  session?: string
): ScopeTree {
  const tree: ScopeTree = {
    scope,
    active: null,
    lanes: new Map(),
    nodes: new Map(),
    gitCursor: null,
  };
  for (const event of events) if (event.scope === scope) apply(tree, event);
  tree.active = tree.lanes.get(session ?? "") ?? null;
  return tree;
}

export function readTree(
  scope: string,
  file: string = workTreeFile(),
  session: string | undefined = workSession()
): ScopeTree {
  return buildTree(scope, readEvents(file), session);
}

/** Nodes another session is working on right now. */
export function activeElsewhere(tree: ScopeTree): WorkNode[] {
  return nodesWithStatus(tree, "active").filter((n) => n.id !== tree.active);
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

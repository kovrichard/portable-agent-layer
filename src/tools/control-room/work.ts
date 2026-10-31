/**
 * The work the progress tree holds open, for the page. Each card is one node
 * that is not done: where it stopped, and what it waits on from the user. The
 * page reads the same events the session-start reminder renders from.
 */

import { basename } from "node:path";
import {
  buildTree,
  type NodeStatus,
  readEvents,
  type WorkEvent,
} from "../../hooks/lib/progress-tree";
import { readAllProjects } from "../../hooks/lib/projects";

const DAY_MS = 86_400_000;
const FRESH_DAYS = 7;
const OPEN_STATUSES: ReadonlySet<NodeStatus> = new Set(["active", "waiting", "parked"]);
const IN_PROGRESS_STATUSES: ReadonlySet<NodeStatus> = new Set(["active", "waiting"]);

export interface WorkCard {
  scope: string;
  slug: string | null;
  label: string;
  node: string;
  title: string;
  status: NodeStatus;
  stoppedAt: string | null;
  waitingOn: string | null;
  at: string;
  ageDays: number;
}

function scopesIn(events: WorkEvent[]): string[] {
  return [...new Set(events.map((e) => e.scope))];
}

function ageInDays(at: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(at)) / DAY_MS);
}

export function openWork(
  now: Date = new Date(),
  events: WorkEvent[] = readEvents()
): WorkCard[] {
  const projects = new Set(readAllProjects().map((p) => p.name));
  return scopesIn(events)
    .flatMap((scope) => {
      const slug = projects.has(scope) ? scope : null;
      return [...buildTree(scope, events).nodes.values()]
        .filter((n) => OPEN_STATUSES.has(n.status))
        .map((n) => ({
          scope,
          slug,
          label: slug ?? basename(scope),
          node: n.id,
          title: n.title,
          status: n.status,
          stoppedAt: n.stoppedAt,
          waitingOn: n.status === "waiting" ? n.waitingOn : null,
          at: n.updated,
          ageDays: ageInDays(n.updated, now),
        }));
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function isInProgress(card: WorkCard): boolean {
  return IN_PROGRESS_STATUSES.has(card.status) && card.ageDays < FRESH_DAYS;
}

export function inProgressWork(cards: WorkCard[]): WorkCard[] {
  return cards.filter(isInProgress);
}

export function waitingOnUser(cards: WorkCard[]): WorkCard[] {
  return cards.filter((c) => c.waitingOn);
}

export function workOf(slug: string, cards: WorkCard[]): WorkCard[] {
  return cards.filter((c) => c.slug === slug);
}

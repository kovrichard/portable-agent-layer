/**
 * The urgent/important grid, over projects and stated goals together.
 *
 * Two rules, both readable off disk, because a screen you open before a terminal
 * cannot wait for a model. Importance comes from what a project serves, which
 * PAL guesses once and the user can overrule. Urgency comes from what the files
 * already say: a blocker, an unfinished handoff, a date coming up, or an
 * important thing that has gone quiet.
 *
 * Every placement carries the reason it landed there, so a wrong guess argues
 * with the user instead of hiding from them.
 */

import {
  type GoalProgress,
  progressFor,
  readGoalLinks,
} from "../../hooks/lib/goal-links";
import {
  type ProjectProgress,
  readAllProjects,
  type ServesAuthority,
  type ServesKind,
} from "../../hooks/lib/projects";
import { isImportant, SERVES_MEANING } from "../../hooks/lib/serves";
import { dueFrom, readTelosGoals, type TelosGoal } from "../../hooks/lib/telos-goals";
import type { HandoffEntry } from "../lib/handoff-note";
import { parseIscs } from "../lib/project-isc";
import { freshHandoffs } from "./data";
import { type ControlRoomPrefs, readPrefs } from "./prefs";
import { readSnoozes, snoozedUntil } from "./snooze";

const RANKED_STATUSES = new Set(["active", "paused"]);

export interface MatrixItem {
  kind: "project" | "goal";
  id: string;
  label: string;
  detail: string;
  urgent: boolean;
  important: boolean;
  /** The quadrant the user pinned this to, which overrules both guesses. */
  placed: string | null;
  urgentBecause: string[];
  importantBecause: string;
  serves: ServesKind | null;
  servesBy: ServesAuthority | null;
  due: string | null;
  waitingOn: string | null;
  /** Counted from the criteria of the projects serving it, or null when none does. */
  progress: { projects: string[]; closed: number; written: number } | null;
}

export interface Matrix {
  now: MatrixItem[];
  plan: MatrixItem[];
  noise: MatrixItem[];
  later: MatrixItem[];
  /** Projects PAL has not guessed a purpose for yet — they rank as unimportant until it does. */
  unranked: number;
}

function dueSoon(due: string | null, now: Date, withinDays: number): boolean {
  if (!due) return false;
  const at = new Date(`${due}T23:59:59Z`).getTime();
  if (!Number.isFinite(at)) return false;
  return at - now.getTime() <= withinDays * 86_400_000;
}

function earliestDue(lines: string[]): string | null {
  const dates = lines.map(dueFrom).filter((d): d is string => d !== null);
  return dates.length > 0 ? dates.sort()[0] : null;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Measured against the grid's own clock, so a placement can be pinned in a test. */
function quietSince(updated: string | undefined, now: Date, afterDays: number): boolean {
  if (!updated) return false;
  const age = now.getTime() - new Date(updated).getTime();
  return Number.isFinite(age) && age > afterDays * 86_400_000;
}

/**
 * A fun project going quiet is just quiet. An important one going quiet is
 * rotting, which is the only reading of staleness worth interrupting a morning for.
 */
function projectUrgency(
  p: ProjectProgress,
  important: boolean,
  waiting: string | null,
  due: string | null,
  hasHandoff: boolean,
  now: Date,
  prefs: ControlRoomPrefs
): string[] {
  const reasons: string[] = [];
  const blockers = p.blockers?.length ?? 0;
  if (blockers > 0) reasons.push(plural(blockers, "blocker"));
  if (waiting) reasons.push("waiting on you");
  else if (hasHandoff) reasons.push("handoff in progress");
  if (dueSoon(due, now, prefs.urgentWithinDays)) reasons.push(`next step dated ${due}`);
  if (
    important &&
    p.status === "active" &&
    quietSince(p.updated, now, prefs.quietAfterDays)
  ) {
    reasons.push("gone quiet");
  }
  return reasons;
}

function projectItem(
  p: ProjectProgress,
  handoffs: Map<string, HandoffEntry>,
  now: Date,
  prefs: ControlRoomPrefs
): MatrixItem {
  const entry = p.path ? handoffs.get(p.path) : undefined;
  const waiting = entry?.waitingOn ?? null;
  const important = isImportant(p.serves);
  const due = earliestDue(p.next ?? []);
  const urgentBecause = projectUrgency(
    p,
    important,
    waiting,
    due,
    entry !== undefined,
    now,
    prefs
  );

  const placed = placementOf(p.placed);
  return {
    kind: "project",
    id: p.name,
    label: p.name,
    detail: p.serves_note ?? p.next?.[0] ?? "",
    urgent: placed ? placed.urgent : urgentBecause.length > 0,
    important: placed ? placed.important : important,
    placed: p.placed ?? null,
    urgentBecause: placed ? ["placed by you", ...urgentBecause] : urgentBecause,
    importantBecause: p.serves
      ? SERVES_MEANING[p.serves]
      : "no purpose on record yet — set one to rank it",
    serves: p.serves ?? null,
    servesBy: p.serves_by ?? null,
    due,
    waitingOn: waiting,
    progress: null,
  };
}

function goalItem(
  goal: TelosGoal,
  now: Date,
  prefs: ControlRoomPrefs,
  progress: GoalProgress | null
): MatrixItem {
  const urgent = dueSoon(goal.due, now, prefs.urgentWithinDays);
  return {
    kind: "goal",
    id: goal.id,
    label: goal.title,
    detail: goal.horizon ?? goal.text,
    urgent,
    important: true,
    placed: null,
    urgentBecause: urgent ? [`dated ${goal.due}`] : [],
    importantBecause: "a goal you stated",
    serves: null,
    servesBy: null,
    due: goal.due,
    waitingOn: null,
    progress,
  };
}

/** The user's placement, translated back into the two axes it stands for. */
function placementOf(
  placed: string | undefined
): { urgent: boolean; important: boolean } | null {
  switch (placed) {
    case "now":
      return { urgent: true, important: true };
    case "plan":
      return { urgent: false, important: true };
    case "noise":
      return { urgent: true, important: false };
    case "later":
      return { urgent: false, important: false };
    default:
      return null;
  }
}

/** Criteria closed over criteria written, with snoozed and retired ones left out. */
function criteriaBySlug(
  projects: ProjectProgress[],
  snoozes: Record<string, string>
): Map<string, { closed: number; written: number }> {
  return new Map(
    projects.map((p) => {
      const iscs = [
        ...parseIscs(p.criteria ?? ""),
        ...parseIscs(p.changelog ?? ""),
      ].filter((i) => i.status !== "retired" && !snoozedUntil(p.name, i.id, snoozes));
      return [
        p.name,
        { closed: iscs.filter((i) => i.status === "done").length, written: iscs.length },
      ];
    })
  );
}

function quadrant(items: MatrixItem[], urgent: boolean, important: boolean) {
  return items
    .filter((i) => i.urgent === urgent && i.important === important)
    .sort(
      (a, b) =>
        b.urgentBecause.length - a.urgentBecause.length || a.label.localeCompare(b.label)
    );
}

/** @lintignore exercised directly by test/control-room-matrix.test.ts */
export function buildMatrix(items: MatrixItem[], unranked: number): Matrix {
  return {
    now: quadrant(items, true, true),
    plan: quadrant(items, false, true),
    noise: quadrant(items, true, false),
    later: quadrant(items, false, false),
    unranked,
  };
}

export function matrix(now: Date = new Date()): Matrix {
  const prefs = readPrefs();
  const handoffs = new Map(freshHandoffs(now));
  const all = readAllProjects();
  const ranked = all.filter((p) => RANKED_STATUSES.has(p.status));
  const links = readGoalLinks();
  const criteria = criteriaBySlug(all, readSnoozes(now));
  const items = [
    ...ranked.map((p) => projectItem(p, handoffs, now, prefs)),
    ...(prefs.rankGoals
      ? readTelosGoals().map((g) =>
          goalItem(g, now, prefs, progressFor(g.id, links, criteria))
        )
      : []),
  ];
  return buildMatrix(items, ranked.filter((p) => !p.serves).length);
}

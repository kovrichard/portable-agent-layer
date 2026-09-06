/**
 * One project, assembled. The board answers "which projects want you"; this
 * answers "what is the state of this one" — the criteria it is judged against,
 * the decisions behind it, and what the agents have been doing to it.
 *
 * Two of its sections live on the record as prose rather than fields, so they
 * are parsed here: decisions are written by `add-decision` in a fixed shape, and
 * context is whatever bullets the ISA carries.
 */

import {
  readProject,
  type ServesAuthority,
  type ServesKind,
} from "../../hooks/lib/projects";
import { SERVES_MEANING } from "../../hooks/lib/serves";
import { anchorSlugOf, queryLedger } from "../ledger/query";
import { type LedgerViewRow, viewRows } from "../ledger/view";
import type { HandoffEntry } from "../lib/handoff-note";
import { type Isc, parseIscs } from "../lib/project-isc";
import { freshHandoffs, handoffSentence } from "./data";

const DAY_MS = 86_400_000;
const RECENT_ACTIONS = 8;
const ACTIVITY_WINDOW_DAYS = 14;

export interface Decision {
  date: string | null;
  text: string;
  why: string | null;
}

interface DetailHandoff {
  sentence: string;
  full: string;
  at: string;
  source: HandoffEntry["source"];
  waitingOn: string | null;
}

export interface ProjectDetailView {
  slug: string;
  status: string;
  path: string | null;
  remote: string | null;
  goal: string;
  purpose: string;
  serves: ServesKind | null;
  servesBy: ServesAuthority | null;
  placed: string | null;
  updated: string;
  iscs: Isc[];
  next: string[];
  blockers: string[];
  decisions: Decision[];
  context: string[];
  handoff: DetailHandoff | null;
  runtimes: Record<string, number>;
  recent: LedgerViewRow[];
}

const DECISION_LINE = /^-\s*(\d{4}-\d{2}-\d{2}):\s*(.+?)(?:\s*\((.+)\))?\s*$/;

/** `add-decision` writes "- YYYY-MM-DD: what (why)"; anything else is kept whole. */
export function parseDecisions(section: string | undefined): Decision[] {
  if (!section) return [];
  const decisions: Decision[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = DECISION_LINE.exec(trimmed);
    decisions.push(
      match
        ? { date: match[1], text: match[2].trim(), why: match[3]?.trim() ?? null }
        : { date: null, text: trimmed.replace(/^-\s*/, ""), why: null }
    );
  }
  return decisions.reverse();
}

/** Bullets when the section has them, otherwise each non-empty line stands alone. */
export function parseBullets(section: string | undefined): string[] {
  if (!section) return [];
  const lines = section
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines.filter((l) => /^[-*+]\s+\S/.test(l));
  const chosen = bullets.length > 0 ? bullets : lines;
  return chosen.map((l) => l.replace(/^[-*+]\s+/, ""));
}

function detailHandoff(entry: HandoffEntry | undefined): DetailHandoff | null {
  if (!entry) return null;
  return {
    sentence: handoffSentence(entry.handoff),
    full: entry.handoff,
    at: entry.timestamp,
    source: entry.source,
    waitingOn: entry.waitingOn ?? null,
  };
}

function activity(slug: string, since: Date) {
  const entries = queryLedger({ since }).filter((e) => anchorSlugOf(e.target) === slug);
  const runtimes = Object.fromEntries(
    Map.groupBy(entries, (e) => e.runtime)
      .entries()
      .map(([runtime, group]) => [runtime, group.length])
  );
  return { runtimes, recent: viewRows(entries).slice(0, RECENT_ACTIONS) };
}

export function projectDetail(
  slug: string,
  now: Date = new Date()
): ProjectDetailView | null {
  const project = readProject(slug);
  if (!project) return null;

  const handoffs = new Map(freshHandoffs(now));
  const { runtimes, recent } = activity(
    slug,
    new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS)
  );

  return {
    slug: project.name,
    status: project.status,
    path: project.path ?? null,
    remote: project.remote ?? null,
    goal: project.goal ?? "",
    purpose: project.serves
      ? SERVES_MEANING[project.serves]
      : "no purpose on record yet — set one to rank it",
    serves: project.serves ?? null,
    servesBy: project.serves_by ?? null,
    placed: project.placed ?? null,
    updated: project.updated,
    iscs: [...parseIscs(project.criteria ?? ""), ...parseIscs(project.changelog ?? "")],
    next: project.next ?? [],
    blockers: project.blockers ?? [],
    decisions: parseDecisions(project.decisions),
    context: parseBullets(project.context),
    handoff: detailHandoff(project.path ? handoffs.get(project.path) : undefined),
    runtimes,
    recent,
  };
}

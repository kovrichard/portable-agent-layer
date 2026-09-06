/**
 * The numbers behind the control room. Every panel reads through the same
 * functions the session-start reminder uses, so the page and the agent can
 * never disagree about a project's state.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadReflectNudge } from "../../hooks/handlers/reflect-trigger";
import { type AgendaMove, readAgenda } from "../../hooks/lib/agenda-store";
import {
  isMaintainerEnv,
  loadAlgorithmReviewNudge,
} from "../../hooks/lib/algorithm-review";
import { loadAnalyzeNudge } from "../../hooks/lib/analyze-nudge";
import { paths } from "../../hooks/lib/paths";
import { isStale, type ProjectProgress, readAllProjects } from "../../hooks/lib/projects";
import { readProjectHistory } from "../../hooks/lib/work-tracking";
import { anchorSlugOf, type LedgerFilter, queryLedger } from "../ledger/query";
import { type HandoffEntry, readHandoffs } from "../lib/handoff-note";
import { parseIscs } from "../lib/project-isc";

const DAY_MS = 86_400_000;
const HANDOFF_FRESH_DAYS = 7;
const SESSION_WINDOW_DAYS = 30;
const SERIES_LENGTH = 60;

export interface ProjectCard {
  slug: string;
  path: string | null;
  status: string;
  updated: string;
  ageDays: number;
  stale: boolean;
  openIscs: number;
  next: string[];
  blockers: string[];
  lastSession: { date: string; title: string } | null;
  sessions30d: number;
  asking: string[];
}

export interface HandoffCard {
  slug: string | null;
  label: string;
  cwd: string;
  title: string;
  sentence: string;
  handoff: string;
  at: string;
  ageDays: number;
  source: HandoffEntry["source"];
}

export interface AgendaView {
  generatedAt: string | null;
  ageHours: number | null;
  stale: boolean;
  moves: AgendaMove[];
}

export interface DueBadge {
  state: "due" | "clear" | "n/a";
  detail: string;
}

export interface RatingPoint {
  ts: string;
  rating: number;
}

export interface SignalView {
  synthesizedAt: string | null;
  ratings: {
    count: number;
    avg: number;
    recentAvg: number;
    lowCount: number;
    trend: string;
  } | null;
  algorithm: {
    reflectionCount: number;
    passRate: number;
    avgSentiment: number;
  } | null;
  series: RatingPoint[];
  due: {
    analysis: DueBadge;
    algorithmReview: DueBadge;
    relationshipReflect: DueBadge;
  };
}

export interface AgentsRow {
  slug: string;
  actions: number;
  runtimes: Record<string, number>;
  machines: number;
  actors: number;
  sessions: number;
}

export interface AgentsView {
  since: string;
  projects: AgentsRow[];
}

function daysBetween(from: string, now: Date): number {
  const age = now.getTime() - new Date(from).getTime();
  return Number.isFinite(age) && age > 0 ? Math.floor(age / DAY_MS) : 0;
}

function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function sessionsSince(path: string | null, since: Date): number {
  if (!path) return 0;
  const floor = isoDay(since);
  return readProjectHistory(path, 200).filter((h) => h.date >= floor).length;
}

export function freshHandoffs(now: Date): [string, HandoffEntry][] {
  return Object.entries(readHandoffs()).filter(
    ([, h]) =>
      h.status === "in-progress" &&
      h.handoff &&
      daysBetween(h.timestamp, now) < HANDOFF_FRESH_DAYS
  );
}

export function askingReasons(
  p: ProjectProgress,
  handoff: HandoffEntry | undefined,
  stale: boolean
): string[] {
  const reasons: string[] = [];
  if (handoff) reasons.push("handoff in progress");
  const blockers = p.blockers?.length ?? 0;
  if (blockers > 0) reasons.push(blockers === 1 ? "1 blocker" : `${blockers} blockers`);
  if (stale && p.status === "active") reasons.push("gone quiet");
  return reasons;
}

function toCard(
  p: ProjectProgress,
  handoff: HandoffEntry | undefined,
  now: Date
): ProjectCard {
  const path = p.path ?? null;
  const stale = isStale(p);
  const history = path ? readProjectHistory(path, 1) : [];
  const last = history.at(-1);
  return {
    slug: p.name,
    path,
    status: p.status,
    updated: p.updated,
    ageDays: daysBetween(p.updated, now),
    stale,
    openIscs: parseIscs(p.criteria ?? "").filter((i) => i.status === "open").length,
    next: p.next ?? [],
    blockers: p.blockers ?? [],
    lastSession: last ? { date: last.date, title: last.title } : null,
    sessions30d: sessionsSince(
      path,
      new Date(now.getTime() - SESSION_WINDOW_DAYS * DAY_MS)
    ),
    asking: askingReasons(p, handoff, stale),
  };
}

export function sortBoard(cards: ProjectCard[]): ProjectCard[] {
  return [...cards].sort(
    (a, b) => b.asking.length - a.asking.length || b.updated.localeCompare(a.updated)
  );
}

export function board(now: Date = new Date()): ProjectCard[] {
  const handoffs = new Map(freshHandoffs(now));
  return sortBoard(
    readAllProjects().map((p) =>
      toCard(p, p.path ? handoffs.get(p.path) : undefined, now)
    )
  );
}

export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = new RegExp(/^.*?[.!?](?=\s|$)/).exec(flat);
  return match ? match[0] : flat;
}

/** An automatic handoff is a transcript excerpt; the user's own words are the part worth a sentence. */
export function handoffSentence(text: string): string {
  const [, userTurn] = text.split(/Last user message:\s*/, 2);
  const spoken = userTurn ? userTurn.split(/\s*Last assistant response:/, 1)[0] : text;
  return firstSentence(spoken);
}

export function handoffs(now: Date = new Date()): HandoffCard[] {
  const slugByPath = new Map(
    readAllProjects()
      .filter((p) => p.path)
      .map((p) => [p.path as string, p.name])
  );
  return freshHandoffs(now)
    .map(([cwd, h]) => ({
      slug: slugByPath.get(cwd) ?? null,
      label: slugByPath.get(cwd) ?? basename(cwd),
      cwd,
      title: h.title,
      sentence: handoffSentence(h.handoff),
      handoff: h.handoff,
      at: h.timestamp,
      ageDays: daysBetween(h.timestamp, now),
      source: h.source,
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The page never writes the agenda — it says how old the one on disk is, so a
 * morning reading yesterday's three moves knows that is what it is looking at.
 */
export function agenda(now: Date = new Date()): AgendaView {
  const stored = readAgenda();
  if (!stored) return { generatedAt: null, ageHours: null, stale: true, moves: [] };
  const ageHours = (now.getTime() - new Date(stored.generatedAt).getTime()) / 3_600_000;
  return {
    generatedAt: stored.generatedAt,
    ageHours: Math.max(0, Math.round(ageHours)),
    stale: !(ageHours < 24),
    moves: stored.moves,
  };
}

/** The nudge text is the verdict; the badge only strips its heading and emoji. */
export function badgeFromNudge(nudge: string): DueBadge {
  if (!nudge) return { state: "clear", detail: "" };
  const detail = nudge.split("\n").slice(1).join(" ").replace(/^\W+/, "").trim();
  return { state: "due", detail };
}

export function dueBadges(now: Date = new Date(), maintainer = isMaintainerEnv()) {
  return {
    analysis: badgeFromNudge(loadAnalyzeNudge(now)),
    algorithmReview: maintainer
      ? badgeFromNudge(loadAlgorithmReviewNudge(now))
      : { state: "n/a" as const, detail: "only in a maintainer checkout" },
    relationshipReflect: badgeFromNudge(loadReflectNudge()),
  };
}

export function ratingSeries(limit = SERIES_LENGTH): RatingPoint[] {
  const file = resolve(paths.signals(), "ratings.jsonl");
  if (!existsSync(file)) return [];
  const points: RatingPoint[] = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { ts?: string; rating?: number };
      if (typeof row.rating === "number" && row.ts)
        points.push({ ts: row.ts, rating: row.rating });
    } catch {}
  }
  return points.slice(-limit);
}

function readSynthesis(): Record<string, unknown> | null {
  const file = resolve(paths.state(), "synthesis.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function signal(now: Date = new Date()): SignalView {
  const s = readSynthesis();
  const ratings = s?.ratings as SignalView["ratings"] | undefined;
  const algorithm = s?.algorithm as SignalView["algorithm"] | undefined;
  return {
    synthesizedAt: typeof s?.timestamp === "string" ? s.timestamp : null,
    ratings: ratings ?? null,
    algorithm: algorithm
      ? {
          reflectionCount: algorithm.reflectionCount,
          passRate: algorithm.passRate,
          avgSentiment: algorithm.avgSentiment,
        }
      : null,
    series: ratingSeries(),
    due: dueBadges(now),
  };
}

function count<T>(items: T[], key: (item: T) => string): number {
  return new Set(items.map(key)).size;
}

export function agentsAtWork(filter: LedgerFilter, now: Date = new Date()): AgentsView {
  const since = filter.since ?? new Date(now.getTime() - SESSION_WINDOW_DAYS * DAY_MS);
  const pathBySlug = new Map(
    readAllProjects()
      .filter((p) => p.path)
      .map((p) => [p.name, p.path as string])
  );
  const bySlug = Map.groupBy(
    queryLedger({ ...filter, since }),
    (e) => anchorSlugOf(e.target) ?? "unanchored"
  );
  const projects = [...bySlug.entries()].map(([slug, entries]) => ({
    slug,
    actions: entries.length,
    runtimes: Object.fromEntries(
      Map.groupBy(entries, (e) => e.runtime)
        .entries()
        .map(([runtime, group]) => [runtime, group.length])
    ),
    machines: count(entries, (e) => e.machine),
    actors: count(entries, (e) => e.actor),
    sessions: sessionsSince(pathBySlug.get(slug) ?? null, since),
  }));
  return {
    since: since.toISOString(),
    projects: projects.sort(
      (a, b) => b.actions - a.actions || a.slug.localeCompare(b.slug)
    ),
  };
}

/**
 * What is waiting on you, and what you have already seen.
 *
 * Every item here is a template over a fact PAL already holds — a refused tool
 * call, an unanswered handoff, a project with no purpose on record. Nothing is
 * inferred: the bell is the one surface that must be instant and always right,
 * and a model in that path would fail silently exactly when it mattered.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "../../hooks/lib/paths";
import { readAllProjects } from "../../hooks/lib/projects";
import { queryLedger } from "../ledger/query";
import { displayTarget } from "../ledger/view";
import { freshHandoffs } from "./data";
import { type AttentionSource, readPrefs } from "./prefs";

const DAY_MS = 86_400_000;
const REFUSAL_WINDOW_DAYS = 7;
const MAX_ITEMS = 40;

export interface AttentionItem {
  id: string;
  source: AttentionSource;
  severity: "alarm" | "waiting" | "note";
  title: string;
  detail: string;
  at: string;
  project: string | null;
  /** Where clicking it should land. */
  href: string;
  read: boolean;
}

export interface AttentionView {
  unread: number;
  items: AttentionItem[];
}

type ReadState = Record<string, string>;

function readFile(): string {
  return resolve(ensureDir(paths.state()), "attention-read.json");
}

function readMarks(): ReadState {
  const file = readFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as ReadState;
  } catch {
    return {};
  }
}

function writeMarks(marks: ReadState): void {
  writeFileSync(readFile(), `${JSON.stringify(marks, null, 2)}\n`, "utf-8");
}

export function markRead(ids: string[], now: Date = new Date()): number {
  const marks = readMarks();
  for (const id of ids) marks[id] = now.toISOString();
  writeMarks(marks);
  return ids.length;
}

function refusals(now: Date): AttentionItem[] {
  const since = new Date(now.getTime() - REFUSAL_WINDOW_DAYS * DAY_MS);
  return queryLedger({ since })
    .filter((e) => e.outcome === "denied" || e.outcome === "blocked")
    .map((e) => ({
      id: `refusal:${e.id}`,
      source: "refusals" as const,
      severity: "alarm" as const,
      title: `${e.outcome === "blocked" ? "Blocked" : "Denied"}: ${e.tool}`,
      detail: e.reason ?? e.command ?? displayTarget(e.target),
      at: e.ts,
      project: anchorProject(e.target),
      href: `/log?outcome=${e.outcome}`,
      read: false,
    }));
}

function anchorProject(target: string): string | null {
  const match = /^\{proj:([^}]+)\}/.exec(target);
  return match ? match[1] : null;
}

function waiting(now: Date): AttentionItem[] {
  const slugByPath = new Map(
    readAllProjects()
      .filter((p) => p.path)
      .map((p) => [p.path as string, p.name])
  );
  return freshHandoffs(now)
    .filter(([, h]) => h.waitingOn)
    .map(([cwd, h]) => {
      const slug = slugByPath.get(cwd) ?? null;
      return {
        id: `waiting:${cwd}:${h.timestamp}`,
        source: "waiting" as const,
        severity: "waiting" as const,
        title: `${slug ?? cwd} is waiting on you`,
        detail: h.waitingOn as string,
        at: h.timestamp,
        project: slug,
        href: slug ? `/projects/${slug}` : "/",
        read: false,
      };
    });
}

function unranked(): AttentionItem[] {
  return readAllProjects()
    .filter((p) => p.status === "active" && !p.serves)
    .map((p) => ({
      id: `unranked:${p.name}`,
      source: "unranked" as const,
      severity: "note" as const,
      title: `${p.name} has no purpose on record`,
      detail: "It ranks as unimportant until you say what it serves.",
      at: p.updated,
      project: p.name,
      href: `/projects/${p.name}`,
      read: false,
    }));
}

const SOURCES: Record<AttentionSource, (now: Date) => AttentionItem[]> = {
  refusals,
  waiting,
  unranked: () => unranked(),
};

export function attention(now: Date = new Date()): AttentionView {
  const prefs = readPrefs();
  const marks = readMarks();
  const items = (Object.keys(SOURCES) as AttentionSource[])
    .filter((source) => prefs.attention[source])
    .flatMap((source) => SOURCES[source](now))
    .map((item) => ({ ...item, read: marks[item.id] !== undefined }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_ITEMS);
  return { unread: items.filter((i) => !i.read).length, items };
}

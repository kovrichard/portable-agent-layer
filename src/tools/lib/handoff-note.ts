/**
 * The handoff store earlier PALs wrote: what an unfinished session left behind
 * for the next one, keyed by the directory the work happened in. Nothing writes
 * new notes; the progress tree's stopped-at replaced it.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "../../hooks/lib/paths";

export interface HandoffEntry {
  timestamp: string;
  title: string;
  status: "in-progress" | "completed";
  handoff: string;
  artifacts: string[];
  source: "deliberate" | "auto";
  /** What the work needs from the human before it can move — the one thing an agent cannot unblock. */
  waitingOn?: string;
}

export type HandoffStore = Record<string, HandoffEntry>;

export function handoffFile(): string {
  return resolve(ensureDir(paths.state()), "last-handoff.json");
}

export function parseHandoffs(content: string): HandoffStore {
  try {
    return JSON.parse(content) as HandoffStore;
  } catch {
    return {};
  }
}

export function readHandoffs(file: string = handoffFile()): HandoffStore {
  if (!existsSync(file)) return {};
  try {
    return parseHandoffs(readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Fills in the one field an auto handoff cannot write for itself. Never
 * overwrites an answer already on the entry, and never invents an entry.
 */
export function withWaitingOn(
  store: HandoffStore,
  cwd: string,
  question: string
): HandoffStore {
  const entry = store[cwd];
  if (!entry || entry.waitingOn) return store;
  return { ...store, [cwd]: { ...entry, waitingOn: question } };
}

/**
 * The handoff store: what an unfinished session leaves behind for the next one,
 * keyed by the directory the work happened in.
 *
 * The tool around this is only ever spawned, so the shape of an entry and the
 * trim that keeps the file a working set were reachable only by running the CLI
 * and reading the file back. Everything here takes the store it operates on and
 * the clock it stamps with.
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

export interface NoteInput {
  cwd: string;
  title: string;
  text: string;
  done: boolean;
  waitingOn?: string;
}

export type HandoffStore = Record<string, HandoffEntry>;

/** The file is a working set, not an archive: the oldest keys fall off first. */
const MAX_ENTRIES = 20;

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

export function trimHandoffs(handoffs: HandoffStore): HandoffStore {
  const entries = Object.entries(handoffs);
  if (entries.length <= MAX_ENTRIES) return handoffs;
  return Object.fromEntries(entries.slice(-MAX_ENTRIES));
}

export const statusOf = (note: NoteInput): HandoffEntry["status"] =>
  note.done ? "completed" : "in-progress";

/** A closed session carries no waiting line, so the key is absent rather than empty. */
export function entryFor(note: NoteInput, now: Date): HandoffEntry {
  return {
    timestamp: now.toISOString(),
    title: note.title,
    status: statusOf(note),
    handoff: note.text,
    artifacts: [],
    source: "deliberate",
    ...(note.waitingOn ? { waitingOn: note.waitingOn } : {}),
  };
}

export function recordNote(
  store: HandoffStore,
  note: NoteInput,
  now: Date
): HandoffStore {
  return trimHandoffs({ ...store, [note.cwd]: entryFor(note, now) });
}

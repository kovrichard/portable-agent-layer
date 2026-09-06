/**
 * Open threads — the questions and decisions that outlive a session.
 *
 * The tool around this is only ever spawned, so the record's shape, the resolve
 * that has to leave every other thread untouched, and the store's line format
 * were reachable only by running the CLI. Each function here takes the store it
 * operates on, plus the clock and directory it stamps with.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentAttribution, type RecordAttribution } from "../../hooks/lib/actor";
import { encodeAnchor } from "../../hooks/lib/anchor";
import { ensureDir, paths } from "../../hooks/lib/paths";

export interface Thread extends RecordAttribution {
  id: string;
  cwd: string;
  title: string;
  context: string;
  status: "open" | "resolved";
  created: string;
  resolved: string | null;
}

export function threadsFile(): string {
  return resolve(ensureDir(paths.state()), "threads.jsonl");
}

/** Time gives the id its order; the random tail keeps two threads in one millisecond apart. */
export function newId(
  now: number = Date.now(),
  random: () => number = Math.random
): string {
  return now.toString(36) + random().toString(36).slice(2, 5);
}

export function parseThreads(content: string): Thread[] {
  try {
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Thread);
  } catch {
    return [];
  }
}

export function readThreads(file: string = threadsFile()): Thread[] {
  if (!existsSync(file)) return [];
  try {
    return parseThreads(readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

export function serializeThreads(threads: Thread[]): string {
  return `${threads.map((thread) => JSON.stringify(thread)).join("\n")}\n`;
}

export function writeThreads(threads: Thread[], file: string = threadsFile()): void {
  writeFileSync(file, serializeThreads(threads), "utf-8");
}

export function newThread(
  title: string,
  context: string,
  now: Date = new Date(),
  cwd: string = process.cwd()
): Thread {
  return {
    id: newId(now.getTime()),
    cwd: encodeAnchor(cwd),
    ...currentAttribution(),
    title,
    context,
    status: "open",
    created: now.toISOString(),
    resolved: null,
  };
}

export function addThread(
  title: string,
  context: string,
  file: string = threadsFile(),
  now: Date = new Date(),
  cwd: string = process.cwd()
): Thread {
  const thread = newThread(title, context, now, cwd);
  appendFileSync(file, `${JSON.stringify(thread)}\n`, "utf-8");
  return thread;
}

export interface Resolution {
  threads: Thread[];
  thread: Thread;
}

/** Returns a new store rather than editing one, so an unknown id changes nothing. */
export function resolveThreadIn(
  threads: Thread[],
  id: string,
  now: Date
): Resolution | null {
  const index = threads.findIndex((t) => t.id === id);
  if (index === -1) return null;
  const thread: Thread = {
    ...threads[index],
    status: "resolved",
    resolved: now.toISOString(),
  };
  return { threads: threads.map((t, i) => (i === index ? thread : t)), thread };
}

export function visibleThreads(threads: Thread[], all: boolean): Thread[] {
  return all ? threads : threads.filter((t) => t.status === "open");
}

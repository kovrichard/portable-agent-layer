/**
 * The thread store an older PAL wrote to memory/state/threads.jsonl. Nothing
 * writes new threads any more; the migrations read it to move open threads on.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RecordAttribution } from "../../hooks/lib/actor";
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

function threadsFile(): string {
  return resolve(ensureDir(paths.state()), "threads.jsonl");
}

function parseThreads(content: string): Thread[] {
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

function serializeThreads(threads: Thread[]): string {
  return `${threads.map((thread) => JSON.stringify(thread)).join("\n")}\n`;
}

export function writeThreads(threads: Thread[], file: string = threadsFile()): void {
  writeFileSync(file, serializeThreads(threads), "utf-8");
}

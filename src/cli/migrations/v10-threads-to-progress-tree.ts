import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveAnchor } from "../../hooks/lib/anchor";
import { appendEvent, scopeOf } from "../../hooks/lib/progress-tree";
import { readThreads, type Thread } from "../../tools/lib/thread";
import type { Migration, MigrationResult } from "./migration";
import { EVENTS_FILE, newProgressTreeFolder } from "./v9-progress-tree-names";

function nodeOf(line: string): string[] {
  try {
    const { node } = JSON.parse(line);

    return typeof node === "string" ? [node] : [];
  } catch {
    return [];
  }
}

function progressTreeNodeIds(): Set<string> {
  const file = resolve(newProgressTreeFolder(), EVENTS_FILE);
  if (!existsSync(file)) return new Set();

  return new Set(readFileSync(file, "utf-8").split("\n").flatMap(nodeOf));
}

function openThreadsNotInTree(): Thread[] {
  const nodes = progressTreeNodeIds();

  return readThreads().filter((t) => t.status === "open" && !nodes.has(t.id));
}

function threadScope(cwd: string): string {
  const anchor = resolveAnchor(cwd);

  return anchor.state === "unresolvable" ? anchor.slug : scopeOf(anchor.path);
}

function openedAt(thread: Thread): Date {
  const created = new Date(thread.created);

  return Number.isNaN(created.getTime()) ? new Date() : created;
}

const laneNoSessionHeld = (thread: Thread) => `thread-${thread.id}`;

function parkThread(thread: Thread): void {
  const scope = threadScope(thread.cwd);
  const at = openedAt(thread);
  const lane = laneNoSessionHeld(thread);
  const open = { title: thread.title, parent: null };
  const park = { stoppedAt: thread.context || undefined };
  appendEvent(scope, thread.id, "open", open, undefined, at, lane);
  appendEvent(scope, thread.id, "park", park, undefined, at, lane);
}

export const v10ThreadsToProgressTree: Migration = {
  id: "v10-threads-to-progress-tree",
  description: "Park every open thread as a node in the progress tree",

  check() {
    const pending = openThreadsNotInTree();

    return {
      pending: pending.length > 0,
      detail: pending.length > 0 ? `${pending.length} open thread(s)` : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const results: string[] = [];
    let skipped = 0;

    for (const thread of openThreadsNotInTree()) {
      try {
        if (!dryRun) parkThread(thread);
        results.push(
          `${thread.id}: ${dryRun ? "would park" : "parked"} "${thread.title}" in ${threadScope(thread.cwd)} (thread source kept)`
        );
      } catch (e) {
        skipped++;
        results.push(`${thread.id}: skipped (${(e as Error).message})`);
      }
    }

    return { migrated: results.length - skipped, skipped, results };
  },
};

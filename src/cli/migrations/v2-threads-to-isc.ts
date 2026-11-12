import { resolve } from "node:path";
import {
  type ProjectProgress,
  readAllProjects,
  readProject,
  writeProject,
} from "../../hooks/lib/projects";
import { readThreads, type Thread, writeThreads } from "../../tools/lib/thread";
import type { Migration, MigrationResult } from "./migration";

function nextIscId(criteria: string): number {
  const ids: number[] = [];

  for (const line of criteria.split("\n")) {
    const m = new RegExp(/^-\s+\[[ x~]\]\s+ISC-(\d+):/i).exec(line);
    if (m) ids.push(Number(m[1]));
  }

  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

function pendingThreadsForProjects(): { thread: Thread; project: ProjectProgress }[] {
  const threads = readThreads().filter((t) => t.status === "open");
  if (threads.length === 0) return [];
  const projects = readAllProjects();
  const results: { thread: Thread; project: ProjectProgress }[] = [];

  for (const thread of threads) {
    const project = projects.find(
      (p) => p.path !== undefined && resolve(p.path) === resolve(thread.cwd)
    );
    if (project) results.push({ thread, project });
  }

  return results;
}

function addThreadAsIsc(thread: Thread, projectName: string): Thread | null {
  const p = readProject(projectName);
  if (!p) return null;
  const current = p.criteria ?? "";
  const id = nextIscId(current);
  const newLine = `- [ ] ISC-${id}: ${thread.title}`;
  p.criteria = current ? `${current.trimEnd()}\n${newLine}` : newLine;
  p.updated = new Date().toISOString();
  writeProject(p);

  return { ...thread, status: "resolved", resolved: new Date().toISOString() };
}

export const v2ThreadsToIsc: Migration = {
  id: "v2-threads-to-isc",
  description: "Migrate open project-scoped threads to ISCs on their project ISA",

  check() {
    const pending = pendingThreadsForProjects();

    return {
      pending: pending.length > 0,
      detail: pending.length > 0 ? `${pending.length} thread(s) to migrate` : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const pending = pendingThreadsForProjects();
    let migrated = 0;
    let skipped = 0;
    const results: string[] = [];

    const threadUpdates: Map<string, Thread> = new Map();

    for (const { thread, project } of pending) {
      try {
        if (!dryRun) {
          const resolvedThread = addThreadAsIsc(thread, project.name);
          if (!resolvedThread) {
            skipped++;
            results.push(`${thread.id}: skipped (project "${project.name}" unreadable)`);
            continue;
          }

          threadUpdates.set(thread.id, resolvedThread);
        }

        migrated++;
        results.push(
          `${thread.id} → ${project.name} ISC: ${dryRun ? "would add" : "added"} "${thread.title}" (thread source kept)`
        );
      } catch {
        skipped++;
        results.push(`${thread.id}: skipped (error)`);
      }
    }

    if (!dryRun && threadUpdates.size > 0) {
      const all = readThreads().map((t) => threadUpdates.get(t.id) ?? t);
      writeThreads(all);
    }

    return { migrated, skipped, results };
  },
};

/**
 * pal cli migrate — versioned, non-destructive data migrations.
 *
 * Each Migration has:
 *   check() — returns whether this migration is needed (safe to call repeatedly)
 *   run()   — applies the migration; NEVER deletes source data
 *
 * Add new migrations by appending to MIGRATIONS. Registry is ordered; migrations
 * run in declaration order. Doctor calls checkPendingMigrations() to surface
 * pending work without running anything.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "../hooks/lib/paths";
import {
  type ProjectProgress,
  type ProjectStatus,
  readAllProjects,
  readProject,
  writeProject,
} from "../hooks/lib/projects";

// ── Types ─────────────────────────────────────────────────────────

interface MigrationResult {
  migrated: number;
  skipped: number;
  results: string[];
}

interface Migration {
  id: string;
  description: string;
  check(): { pending: boolean; detail?: string };
  run(dryRun?: boolean): MigrationResult;
}

// ── v1-projects: JSON progress files → ISA.md ─────────────────────

interface LegacyDecision {
  ts: string;
  decision: string;
  rationale: string;
}

interface LegacyProject {
  name: string;
  path: string;
  status: ProjectStatus;
  created: string;
  updated: string;
  facts?: string[];
  objectives?: string[];
  next_steps?: string[];
  blockers?: string[];
  handoff?: string;
  decisions?: LegacyDecision[];
}

function pendingJsonFiles(): string[] {
  const progressDir = paths.progress();
  if (!existsSync(progressDir)) return [];
  return readdirSync(progressDir)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !readProject(f.slice(0, -5)));
}

const v1Projects: Migration = {
  id: "v1-projects",
  description: "Migrate legacy JSON progress files to ISA.md format",

  check() {
    const pending = pendingJsonFiles();
    return {
      pending: pending.length > 0,
      detail: pending.length > 0 ? `${pending.length} file(s) in progress/` : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const progressDir = paths.progress();
    const files = pendingJsonFiles();

    let migrated = 0;
    let skipped = 0;
    const results: string[] = [];

    for (const file of files) {
      const slug = file.slice(0, -5);
      const filePath = resolve(progressDir, file);

      try {
        const raw = JSON.parse(readFileSync(filePath, "utf-8")) as LegacyProject;
        if (!raw?.name || !raw?.path || !raw?.status) {
          skipped++;
          results.push(`${slug}: skipped (malformed JSON)`);
          continue;
        }

        if (!dryRun) {
          const p: ProjectProgress = {
            name: raw.name,
            path: raw.path,
            status: raw.status,
            created: raw.created ?? new Date().toISOString(),
            updated: raw.updated ?? new Date().toISOString(),
            ...(raw.handoff ? { handoff: raw.handoff } : {}),
            ...(raw.next_steps?.length ? { next: raw.next_steps } : {}),
            ...(raw.blockers?.length ? { blockers: raw.blockers } : {}),
          };

          if (raw.facts?.length) p.context = raw.facts.join("\n");
          if (raw.objectives?.length)
            p.goal = raw.objectives.map((o) => `- ${o}`).join("\n");
          if (raw.decisions?.length) {
            p.decisions = raw.decisions
              .map((d) => `- ${d.ts.slice(0, 10)}: ${d.decision} (${d.rationale})`)
              .join("\n");
          }

          writeProject(p);
        }

        migrated++;
        results.push(`${slug}: ${dryRun ? "would migrate" : "migrated"} (source kept)`);
      } catch {
        skipped++;
        results.push(`${slug}: skipped (read/write error)`);
      }
    }

    return { migrated, skipped, results };
  },
};

// ── v2-threads-to-isc: open threads → ISCs on matching project ────

interface Thread {
  id: string;
  cwd: string;
  title: string;
  context: string;
  status: "open" | "resolved";
  created: string;
  resolved: string | null;
}

function readThreads(): Thread[] {
  const p = resolve(paths.state(), "threads.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Thread);
}

function writeThreads(threads: Thread[]): void {
  writeFileSync(
    resolve(paths.state(), "threads.jsonl"),
    `${threads.map((t) => JSON.stringify(t)).join("\n")}\n`,
    "utf-8"
  );
}

function nextIscId(criteria: string): number {
  const ids: number[] = [];
  for (const line of criteria.split("\n")) {
    const m = line.match(/^-\s+\[[ x]\]\s+ISC-(\d+):/i);
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
    const project = projects.find((p) => resolve(p.path) === resolve(thread.cwd));
    if (project) results.push({ thread, project });
  }
  return results;
}

const v2ThreadsToIsc: Migration = {
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
          const p = readProject(project.name);
          if (!p) {
            skipped++;
            results.push(`${thread.id}: skipped (project "${project.name}" unreadable)`);
            continue;
          }
          const current = p.criteria ?? "";
          const id = nextIscId(current);
          const newLine = `- [ ] ISC-${id}: ${thread.title}`;
          p.criteria = current ? `${current.trimEnd()}\n${newLine}` : newLine;
          p.updated = new Date().toISOString();
          writeProject(p);
          threadUpdates.set(thread.id, {
            ...thread,
            status: "resolved",
            resolved: new Date().toISOString(),
          });
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

// ── Registry ──────────────────────────────────────────────────────

const MIGRATIONS: Migration[] = [v1Projects, v2ThreadsToIsc];

// ── Public API ────────────────────────────────────────────────────

interface PendingMigration {
  id: string;
  description: string;
  detail?: string;
}

/** Returns migrations that have pending work. Used by doctor. */
export function checkPendingMigrations(): PendingMigration[] {
  return MIGRATIONS.flatMap((m) => {
    const { pending, detail } = m.check();
    return pending ? [{ id: m.id, description: m.description, detail }] : [];
  });
}

/** Entry point for `pal cli migrate`. */
export function runMigrate(args: string[]): void {
  const dryRun = args.includes("--dry-run");
  const list = args.includes("--list");

  if (list) {
    const pending = checkPendingMigrations();
    const done = MIGRATIONS.filter((m) => !m.check().pending);

    console.log("");
    if (pending.length > 0) {
      console.log("  Pending migrations:");
      for (const m of pending) {
        const detail = m.detail ? ` (${m.detail})` : "";
        console.log(`    ⚠ ${m.id} — ${m.description}${detail}`);
      }
    } else {
      console.log("  No pending migrations.");
    }
    if (done.length > 0) {
      console.log("  Done:");
      for (const m of done) {
        console.log(`    ✓ ${m.id} — ${m.description}`);
      }
    }
    console.log("");
    return;
  }

  const pending = MIGRATIONS.filter((m) => m.check().pending);
  if (pending.length === 0) {
    console.log("  Nothing to migrate — all up to date.");
    return;
  }

  if (dryRun) console.log("  Dry run — no files will be written.\n");

  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const m of pending) {
    console.log(`  Running: ${m.id} — ${m.description}`);
    const result = m.run(dryRun);
    totalMigrated += result.migrated;
    totalSkipped += result.skipped;
    for (const r of result.results) {
      console.log(`    ${r}`);
    }
  }

  console.log("");
  console.log(
    `  ${dryRun ? "Would migrate" : "Migrated"}: ${totalMigrated} | Skipped: ${totalSkipped}`
  );
  if (!dryRun && totalMigrated > 0) {
    console.log("  Source files preserved — delete manually once verified.");
  }
  console.log("");
}

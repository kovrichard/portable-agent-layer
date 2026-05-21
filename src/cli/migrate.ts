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

import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { palHome, paths } from "../hooks/lib/paths";
import {
  legacyJsonToProgress,
  type ProjectProgress,
  readAllProjects,
  readProject,
  writeProject,
} from "../hooks/lib/projects";
import { readThreads, type Thread, writeThreads } from "../tools/agent/thread";
import { appendSourceLog } from "../tools/knowledge/ingest";
import {
  type Entity,
  type EntityFrontmatter,
  exists as knowledgeExists,
  save as knowledgeSave,
  slugify,
} from "../tools/knowledge/lib";

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
        const raw = JSON.parse(readFileSync(filePath, "utf-8"));
        const p = legacyJsonToProgress(raw);
        if (!p) {
          skipped++;
          results.push(`${slug}: skipped (malformed JSON)`);
          continue;
        }
        if (!dryRun) writeProject(p);
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

function nextIscId(criteria: string): number {
  const ids: number[] = [];
  for (const line of criteria.split("\n")) {
    const m = new RegExp(/^-\s+\[[ x]\]\s+ISC-(\d+):/i).exec(line);
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

// ── v3-entities-to-knowledge: entity-index.json → knowledge/*.md ──

interface LegacyPerson {
  id: string;
  name: string;
  first_seen: string;
  occurrences: number;
  source_ids: string[];
}

interface LegacyCompany {
  id: string;
  name: string;
  domain: string | null;
  first_seen: string;
  occurrences: number;
  source_ids: string[];
}

interface LegacyIndex {
  version?: string;
  people?: Record<string, LegacyPerson>;
  companies?: Record<string, LegacyCompany>;
  links?: Record<string, unknown>;
  sources?: Record<string, unknown>;
}

function legacyEntitiesPath(): string {
  // Read from PAL_HOME-aware location to match where the legacy store lived;
  // computed locally now that paths.entities() is being retired alongside this migration.
  const home = palHome();
  const dir = resolve(home, "memory", "entities");
  return resolve(dir, "entity-index.json");
}

function readLegacyIndex(): LegacyIndex | null {
  const p = legacyEntitiesPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as LegacyIndex;
  } catch {
    return null;
  }
}

function countLegacyEntries(idx: LegacyIndex): number {
  return Object.keys(idx.people ?? {}).length + Object.keys(idx.companies ?? {}).length;
}

function legacyPersonToEntity(legacy: LegacyPerson): Entity {
  const fm: EntityFrontmatter = {
    title: legacy.name,
    type: "person",
    tags: [],
    created: legacy.first_seen,
    updated: legacy.first_seen,
    quality: 5,
    status: "seedling",
    related: [],
    legacy_id: legacy.id,
    occurrences: legacy.occurrences,
  };
  let body = "";
  for (const sourceId of legacy.source_ids) {
    body = appendSourceLog(body, sourceId, null, {}, legacy.first_seen);
  }
  return { domain: "People", slug: slugify(legacy.name), frontmatter: fm, body };
}

function legacyCompanyToEntity(legacy: LegacyCompany): Entity {
  const baseKey = legacy.domain?.trim() ? legacy.domain : legacy.name;
  const fm: EntityFrontmatter = {
    title: legacy.name,
    type: "company",
    tags: [],
    created: legacy.first_seen,
    updated: legacy.first_seen,
    quality: 5,
    status: "seedling",
    related: [],
    legacy_id: legacy.id,
    occurrences: legacy.occurrences,
  };
  if (legacy.domain) fm.domain_name = legacy.domain;
  let body = "";
  for (const sourceId of legacy.source_ids) {
    body = appendSourceLog(body, sourceId, null, {}, legacy.first_seen);
  }
  return { domain: "Companies", slug: slugify(baseKey), frontmatter: fm, body };
}

const v3EntitiesToKnowledge: Migration = {
  id: "v3-entities-to-knowledge",
  description: "Migrate legacy entity-index.json to knowledge/{People,Companies}/*.md",

  check() {
    const idx = readLegacyIndex();
    if (!idx) return { pending: false };
    const total = countLegacyEntries(idx);
    if (total === 0) return { pending: false };
    // Skip if every entity already exists in the new store (idempotent).
    let remaining = 0;
    for (const p of Object.values(idx.people ?? {})) {
      if (!knowledgeExists("People", slugify(p.name))) remaining++;
    }
    for (const c of Object.values(idx.companies ?? {})) {
      const key = c.domain?.trim() ? c.domain : c.name;
      if (!knowledgeExists("Companies", slugify(key))) remaining++;
    }
    return {
      pending: remaining > 0,
      detail: remaining > 0 ? `${remaining} of ${total} entries to migrate` : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const idx = readLegacyIndex();
    if (!idx) return { migrated: 0, skipped: 0, results: [] };

    let migrated = 0;
    let skipped = 0;
    const results: string[] = [];

    // Refuse to silently drop links/sources if a future legacy index has them.
    const linksCount = Object.keys(idx.links ?? {}).length;
    const sourcesCount = Object.keys(idx.sources ?? {}).length;
    if (linksCount > 0 || sourcesCount > 0) {
      results.push(
        `aborted: legacy index has ${linksCount} link(s) and ${sourcesCount} source(s) — no destination in new store`
      );
      return { migrated: 0, skipped: linksCount + sourcesCount, results };
    }

    for (const legacy of Object.values(idx.people ?? {})) {
      const entity = legacyPersonToEntity(legacy);
      if (knowledgeExists(entity.domain, entity.slug)) {
        skipped++;
        results.push(`People/${entity.slug}: skipped (already in new store)`);
        continue;
      }
      if (!dryRun) knowledgeSave(entity);
      migrated++;
      results.push(`People/${entity.slug}: ${dryRun ? "would migrate" : "migrated"}`);
    }

    for (const legacy of Object.values(idx.companies ?? {})) {
      const entity = legacyCompanyToEntity(legacy);
      if (knowledgeExists(entity.domain, entity.slug)) {
        skipped++;
        results.push(`Companies/${entity.slug}: skipped (already in new store)`);
        continue;
      }
      if (!dryRun) knowledgeSave(entity);
      migrated++;
      results.push(`Companies/${entity.slug}: ${dryRun ? "would migrate" : "migrated"}`);
    }

    // After a successful, non-dry-run migration, archive the legacy file so
    // re-runs don't repeatedly load and skip its contents.
    if (!dryRun && migrated > 0) {
      const src = legacyEntitiesPath();
      if (existsSync(src)) {
        const date = new Date().toISOString().slice(0, 10);
        const archived = `${src}.migrated-${date}`;
        try {
          renameSync(src, archived);
          results.push(`archived legacy index → ${archived}`);
        } catch (e) {
          results.push(`warn: could not rename legacy index (${(e as Error).message})`);
        }
      }
    }

    return { migrated, skipped, results };
  },
};

// ── Registry ──────────────────────────────────────────────────────

const MIGRATIONS: Migration[] = [v1Projects, v2ThreadsToIsc, v3EntitiesToKnowledge];

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

/**
 * pal cli migrate — the only place PAL knows about its own past.
 *
 * Each Migration has:
 *   check() — reads what is on disk, so it is safe to call on every install
 *   run()   — applies it; user data is moved, never deleted, while leftovers
 *             PAL itself wrote and no longer reads are removed
 *
 * Retiring a setting, hook, file or name means adding a migration that removes
 * its leftovers. Install runs pending migrations first; the doctor lists them.
 */

import { appendEvent, logQuietly } from "../bronze/events";
import { LEFTOVERS, type Leftover } from "./leftovers";
import type { Migration, MigrationResult } from "./migrations/migration";
import { v1Projects } from "./migrations/v1-projects";
import { v2ThreadsToIsc } from "./migrations/v2-threads-to-isc";
import { v3EntitiesToKnowledge } from "./migrations/v3-entities-to-knowledge";
import { v4PathsToBindings } from "./migrations/v4-paths-to-bindings";
import { v5AttributionKeys } from "./migrations/v5-attribution-keys";
import { v6HistorySlugs } from "./migrations/v6-history-slugs";
import { v7RetiredSettingsKeys } from "./migrations/v7-retired-settings-keys";
import { v8FactoryHome } from "./migrations/v8-factory-home";
import { v9ProgressTreeNames } from "./migrations/v9-progress-tree-names";
import { v10ThreadsToProgressTree } from "./migrations/v10-threads-to-progress-tree";
import { v11MemoryBackups } from "./migrations/v11-memory-backups";
import { v12RawToRecords } from "./migrations/v12-raw-to-records";
import { v13SettingsToRoot } from "./migrations/v13-settings-to-root";
import { v14RecordsStores } from "./migrations/v14-records-stores";

function leftoverMigration(leftover: Leftover): Migration {
  return {
    id: leftover.id,
    description: leftover.description,
    movesSources: true,
    check() {
      const found = leftover.find();

      return { pending: found.length > 0, detail: found.join(", ") || undefined };
    },
    run(dryRun = false): MigrationResult {
      const found = leftover.find();
      if (found.length === 0) return { migrated: 0, skipped: 0, results: [] };

      if (!dryRun) leftover.remove();
      const verb = dryRun ? "would remove" : "removed";

      return {
        migrated: found.length,
        skipped: 0,
        results: [`${verb} ${found.join(", ")}`],
      };
    },
  };
}

const MIGRATIONS: Migration[] = [
  v1Projects,
  v2ThreadsToIsc,
  v3EntitiesToKnowledge,
  v4PathsToBindings,
  v5AttributionKeys,
  v6HistorySlugs,
  v7RetiredSettingsKeys,
  v8FactoryHome,
  v9ProgressTreeNames,
  v10ThreadsToProgressTree,
  v11MemoryBackups,
  v12RawToRecords,
  v13SettingsToRoot,
  v14RecordsStores,
  ...LEFTOVERS.map(leftoverMigration),
];

function runsOnInstall(migration: Migration): boolean {
  return !migration.requiresOwner;
}

// ── Public API ────────────────────────────────────────────────────

interface PendingMigration {
  id: string;
  description: string;
  detail?: string;
  ownerRun: boolean;
}

interface RunKind {
  dryRun: boolean;
  undo: boolean;
  sweep?: boolean;
}

function recordRun(
  migration: Migration,
  kind: RunKind,
  result: MigrationResult | null
): void {
  const counts = result && { migrated: result.migrated, skipped: result.skipped };
  logQuietly("migration_run", () =>
    appendEvent(
      "migration_run",
      {
        migration: migration.id,
        outcome: result ? "done" : "failed",
        ...counts,
        ...kind,
      },
      result ? { content: { results: result.results } } : {}
    )
  );
}

function recorded(
  migration: Migration,
  kind: RunKind,
  run: () => MigrationResult
): MigrationResult {
  try {
    const result = run();
    recordRun(migration, kind, result);

    return result;
  } catch (err) {
    recordRun(migration, kind, null);
    throw err;
  }
}

/** Runs a migration and lands one migration_run event in bronze, a failure included. */
export function runRecorded(
  migration: Migration,
  dryRun: boolean,
  options: { force?: boolean } = {}
): MigrationResult {
  return recorded(migration, { dryRun, undo: false }, () =>
    migration.run(dryRun, options)
  );
}

/** A sweep that found nothing is not an event; one that folded files in is. */
function sweepRecorded(
  migration: Migration & Required<Pick<Migration, "sweep">>
): string[] {
  const result = migration.sweep();
  if (result.migrated === 0) return [];
  recordRun(migration, { dryRun: false, undo: false, sweep: true }, result);

  return result.results.map((line) => `${migration.id}: ${line}`);
}

/** Every install folds in what old processes wrote to old paths after a move. */
function sweepLateWrites(): string[] {
  return MIGRATIONS.flatMap((m) =>
    m.sweep ? sweepRecorded({ ...m, sweep: m.sweep }) : []
  );
}

export function undoRecorded(
  migration: Migration & Required<Pick<Migration, "undo">>
): MigrationResult {
  return recorded(migration, { dryRun: false, undo: true }, () => migration.undo());
}

/**
 * Install runs these first, so one install leaves nothing an older PAL wrote.
 * A migration that moves recorded data waits for its owner; the doctor lists it.
 */
export function applyPendingMigrations(): string[] {
  const applied = MIGRATIONS.filter((m) => runsOnInstall(m) && m.check().pending).flatMap(
    (m) => runRecorded(m, false).results.map((line) => `${m.id}: ${line}`)
  );

  return [...applied, ...sweepLateWrites()];
}

/** Returns migrations that have pending work. Used by doctor. */
export function checkPendingMigrations(): PendingMigration[] {
  return MIGRATIONS.flatMap((m) => {
    const { pending, detail } = m.check();

    return pending
      ? [{ id: m.id, description: m.description, detail, ownerRun: !runsOnInstall(m) }]
      : [];
  });
}

function printMigrationList(): void {
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
}

function undoMigration(id: string | undefined): void {
  const migration = MIGRATIONS.find((m) => m.id === id);
  const undoable = MIGRATIONS.filter((m) => m.undo).map((m) => m.id);

  if (!migration?.undo) {
    console.log(`  Nothing to undo for "${id ?? ""}". Undoable: ${undoable.join(", ")}`);

    return;
  }

  for (const line of undoRecorded({ ...migration, undo: migration.undo }).results)
    console.log(`  ${line}`);
}

/** Entry point for `pal cli migrate`. */
export function runMigrate(args: string[]): void {
  const dryRun = args.includes("--dry-run");
  const list = args.includes("--list");
  const undoIndex = args.indexOf("--undo");

  if (undoIndex >= 0) {
    undoMigration(args[undoIndex + 1]);

    return;
  }

  if (list) {
    printMigrationList();

    return;
  }

  const named = args.find((a) => !a.startsWith("-"));
  if (named !== undefined) {
    runNamed(named, dryRun, args.includes("--force"));

    return;
  }

  const pending = MIGRATIONS.filter((m) => m.check().pending);
  const waiting = pending.filter((m) => !runsOnInstall(m));
  runAll(pending.filter(runsOnInstall), dryRun);
  printWaitingForOwner(waiting);
}

function printWaitingForOwner(waiting: Migration[]): void {
  if (waiting.length === 0) return;
  console.log("  Waiting for you to run them (they move recorded data):");

  for (const m of waiting) console.log(`    pal cli migrate ${m.id} — ${m.description}`);
  console.log("");
}

function runNamed(id: string, dryRun: boolean, force: boolean): void {
  const migration = MIGRATIONS.find((m) => m.id === id);
  if (!migration) {
    console.log(
      `  No migration "${id}". Known: ${MIGRATIONS.map((m) => m.id).join(", ")}`
    );

    return;
  }

  if (!migration.check().pending) {
    console.log(`  ${id}: nothing to do.`);

    return;
  }

  if (dryRun) console.log("  Dry run — no files will be written.\n");
  console.log(`  Running: ${id} — ${migration.description}`);

  for (const line of runRecorded(migration, dryRun, { force }).results)
    console.log(`    ${line}`);
  console.log("");
}

function runAll(pending: Migration[], dryRun: boolean): void {
  if (pending.length === 0) {
    console.log("  Nothing to migrate — all up to date.");

    return;
  }

  if (dryRun) console.log("  Dry run — no files will be written.\n");

  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const m of pending) {
    console.log(`  Running: ${m.id} — ${m.description}`);
    const result = runRecorded(m, dryRun);
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

  if (!dryRun && totalMigrated > 0 && pending.some((m) => !m.movesSources)) {
    console.log("  Source files preserved — delete manually once verified.");
  }

  console.log("");
}

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
  ...LEFTOVERS.map(leftoverMigration),
];

// ── Public API ────────────────────────────────────────────────────

interface PendingMigration {
  id: string;
  description: string;
  detail?: string;
}

/** Install runs these first, so one install leaves nothing an older PAL wrote. */
export function applyPendingMigrations(): string[] {
  return MIGRATIONS.filter((m) => m.check().pending).flatMap((m) =>
    m.run(false).results.map((line) => `${m.id}: ${line}`)
  );
}

/** Returns migrations that have pending work. Used by doctor. */
export function checkPendingMigrations(): PendingMigration[] {
  return MIGRATIONS.flatMap((m) => {
    const { pending, detail } = m.check();

    return pending ? [{ id: m.id, description: m.description, detail }] : [];
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

/** Entry point for `pal cli migrate`. */
export function runMigrate(args: string[]): void {
  const dryRun = args.includes("--dry-run");
  const list = args.includes("--list");

  if (list) {
    printMigrationList();

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

  if (!dryRun && totalMigrated > 0 && pending.some((m) => !m.movesSources)) {
    console.log("  Source files preserved — delete manually once verified.");
  }

  console.log("");
}

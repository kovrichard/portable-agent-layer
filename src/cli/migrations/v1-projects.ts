import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "../../hooks/lib/paths";
import { readProject, writeProject } from "../../hooks/lib/projects";
import { legacyJsonToProgress } from "../../hooks/lib/projects-legacy";
import type { Migration, MigrationResult } from "./migration";

function pendingJsonFiles(): string[] {
  const progressDir = paths.progress();
  if (!existsSync(progressDir)) return [];

  return readdirSync(progressDir)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !readProject(f.slice(0, -5)));
}

export const v1Projects: Migration = {
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

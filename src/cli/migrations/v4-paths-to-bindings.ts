import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "../../hooks/lib/paths";
import { readProject, writeProject } from "../../hooks/lib/projects";
import type { Migration, MigrationResult } from "./migration";

function rewriteSoTheWriterMovesThePathToABinding(
  project: NonNullable<ReturnType<typeof readProject>>
): void {
  writeProject(project);
}

/** Records written before bindings existed carry their own `path:` in frontmatter. */
function recordsCarryingAPath(): string[] {
  const base = paths.projectHistory();
  if (!existsSync(base)) return [];
  const out: string[] = [];

  for (const slug of readdirSync(base)) {
    const file = resolve(base, slug, "ISA.md");
    if (!existsSync(file)) continue;
    const frontmatter = readFileSync(file, "utf-8").split("---")[1] ?? "";
    if (/^path:/m.test(frontmatter)) out.push(slug);
  }

  return out;
}

export const v4PathsToBindings: Migration = {
  id: "v4-paths-to-bindings",
  description: "Move project paths out of records into machine-local bindings",

  check() {
    const stale = recordsCarryingAPath();

    return {
      pending: stale.length > 0,
      detail:
        stale.length > 0 ? `${stale.length} record(s) still store a path` : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const stale = recordsCarryingAPath();
    const results: string[] = [];
    let migrated = 0;
    let skipped = 0;

    for (const slug of stale) {
      const project = readProject(slug);
      if (!project) {
        skipped++;
        results.push(`${slug}: unreadable, left untouched`);
        continue;
      }

      if (dryRun) {
        migrated++;
        results.push(`${slug}: would move ${project.path ?? "(no path)"} to a binding`);
        continue;
      }

      rewriteSoTheWriterMovesThePathToABinding(project);
      migrated++;
      results.push(`${slug}: path moved to a binding`);
    }

    return { migrated, skipped, results };
  },
};

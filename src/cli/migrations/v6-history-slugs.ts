import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { readBindings } from "../../hooks/lib/bindings";
import { foldHistoryInto } from "../../hooks/lib/parked-history";
import { paths } from "../../hooks/lib/paths";
import { projectPathOnThisMachine, readAllProjects } from "../../hooks/lib/projects";
import { discardEmptyFolder, type Migration, type MigrationResult } from "./migration";

/**
 * Session history used to be keyed on the last segment of the cwd, so a session
 * in an unregistered directory minted a project-shaped folder, and a project
 * checked out under a differently-named directory had its history filed under
 * that directory instead. Both now route through `historyFileFor`; this brings
 * the records already on disk onto the same rule.
 */
interface StrandedHistory {
  slug: string;
  file: string;
  owner: string | null;
  parked: boolean;
}

function orphanHistoryFolders(): { slug: string; file: string }[] {
  const base = paths.projectHistory();
  if (!existsSync(base)) return [];
  const out: { slug: string; file: string }[] = [];

  for (const slug of readdirSync(base)) {
    const dir = resolve(base, slug);
    const file = resolve(dir, "history.jsonl");
    if (!existsSync(file) || existsSync(resolve(dir, "ISA.md"))) continue;
    out.push({ slug, file });
  }

  return out;
}

function parkedHistoryFiles(): { slug: string; file: string }[] {
  const base = paths.unboundHistory();
  if (!existsSync(base)) return [];

  return readdirSync(base)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ slug: f.slice(0, -".jsonl".length), file: resolve(base, f) }));
}

/** The project checked out in a directory of this name, when exactly one is. */
function projectOwningDirectoryNamed(slug: string): string | null {
  const bindings = readBindings();
  const owners = readAllProjects().filter((p) => {
    const path = projectPathOnThisMachine(p, bindings);

    return path !== null && basename(path) === slug;
  });

  return owners.length === 1 ? owners[0].name : null;
}

/** Orphans always move; parked history moves only once its project appears. */
function strandedHistory(): StrandedHistory[] {
  const out: StrandedHistory[] = [];

  for (const { slug, file } of orphanHistoryFolders()) {
    out.push({ slug, file, owner: projectOwningDirectoryNamed(slug), parked: false });
  }

  for (const { slug, file } of parkedHistoryFiles()) {
    const owner = projectOwningDirectoryNamed(slug);
    if (owner) out.push({ slug, file, owner, parked: true });
  }

  return out;
}

function destinationFor(item: StrandedHistory): string {
  return item.owner
    ? resolve(paths.projectHistory(), item.owner, "history.jsonl")
    : resolve(paths.unboundHistory(), `${item.slug}.jsonl`);
}

export const v6HistorySlugs: Migration = {
  id: "v6-history-slugs",
  description: "Re-file session history keyed on a cwd name onto its owning project",
  movesSources: true,

  check() {
    const stranded = strandedHistory();

    return {
      pending: stranded.length > 0,
      detail:
        stranded.length > 0
          ? `${stranded.length} history file(s) filed under a directory name`
          : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const results: string[] = [];
    let migrated = 0;
    let skipped = 0;

    for (const item of strandedHistory()) {
      const target = destinationFor(item);
      const where = item.owner ? `project ${item.owner}` : "unbound-history";

      if (dryRun) {
        migrated++;
        results.push(`${item.slug}: would move to ${where}`);
        continue;
      }

      try {
        const added = foldHistoryInto(target, item.file);
        unlinkSync(item.file);

        if (!item.parked) discardEmptyFolder(dirname(item.file));
        migrated++;
        results.push(`${item.slug}: ${added} entr(ies) moved to ${where}`);
      } catch (e) {
        skipped++;
        results.push(`${item.slug}: skipped (${(e as Error).message})`);
      }
    }

    return { migrated, skipped, results };
  },
};

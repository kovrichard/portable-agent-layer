import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { palHome, paths } from "../../hooks/lib/paths";
import type { Migration, MigrationResult } from "./migration";

/**
 * Records stamped their origin as `m`, which nobody could decode without
 * reading the writer. The stamp is now spelled out — machine, actor, runtime,
 * authority — and this brings historical rows onto the same schema, because a
 * mixed schema in an append-only store is exactly what makes it unauditable
 * later. Nothing ever read `m`, so no consumer depends on the old spelling.
 */
function attributionFiles(): string[] {
  const files = [paths.reflectionsFile(), resolve(paths.state(), "threads.jsonl")];
  const signalsDir = paths.signals();
  if (existsSync(signalsDir)) {
    for (const name of readdirSync(signalsDir)) {
      if (name.endsWith(".jsonl")) files.push(resolve(signalsDir, name));
    }
  }

  return files.filter((f) => existsSync(f));
}

/** Lines carrying the old key. A line already using `machine` is left alone. */
function renameAttributionKey(raw: string): { text: string; changed: number } {
  const lines = raw.split("\n");
  let changed = 0;

  const out = lines.map((line) => {
    if (!line.trim()) return line;
    let record: Record<string, unknown>;

    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return line; // a malformed line is left exactly as found
    }

    if (!("m" in record)) return line;

    const { m, ...rest } = record;
    changed++;

    // `rest` spreads last so a record already carrying `machine` keeps that
    // value and still sheds the stale `m`.
    return JSON.stringify({ machine: m, ...rest });
  });

  return { text: out.join("\n"), changed };
}

function filesCarryingOldKey(): string[] {
  return attributionFiles().filter(
    (f) => renameAttributionKey(readFileSync(f, "utf-8")).changed > 0
  );
}

export const v5AttributionKeys: Migration = {
  id: "v5-attribution-keys",
  description: "Rename the origin stamp `m` to `machine` on stored records",

  check() {
    const stale = filesCarryingOldKey();

    return {
      pending: stale.length > 0,
      detail:
        stale.length > 0
          ? `${stale.length} file(s) still stamp origin as \`m\``
          : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const results: string[] = [];
    let migrated = 0;

    for (const file of filesCarryingOldKey()) {
      const { text, changed } = renameAttributionKey(readFileSync(file, "utf-8"));
      const name = file.replace(palHome(), "").replaceAll("\\", "/");

      if (dryRun) {
        results.push(`${name}: would rewrite ${changed} record(s)`);
        migrated++;
        continue;
      }

      writeFileSync(file, text, "utf-8");
      results.push(`${name}: ${changed} record(s) rewritten`);
      migrated++;
    }

    return { migrated, skipped: 0, results };
  },
};

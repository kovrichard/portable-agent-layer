import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "../../hooks/lib/paths";
import { readProject, writeProject } from "../../hooks/lib/projects";
import { legacyJsonToProgress } from "../../hooks/lib/projects-legacy";
import { ok } from "./project-io";

export function cmdMigrate(): undefined {
  const progressDir = paths.progress();
  if (!existsSync(progressDir)) {
    ok({ migrated: 0, skipped: 0, results: [] });

    return;
  }

  const files = readdirSync(progressDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    ok({ migrated: 0, skipped: 0, results: [] });

    return;
  }

  let migrated = 0;
  let skipped = 0;
  const results: string[] = [];

  for (const file of files) {
    const slug = file.slice(0, -5);
    const filePath = resolve(progressDir, file);

    if (readProject(slug)) {
      skipped++;
      results.push(`${slug}: skipped (ISA.md already exists)`);
      continue;
    }

    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8"));
      const p = legacyJsonToProgress(raw);
      if (!p) {
        skipped++;
        results.push(`${slug}: skipped (malformed JSON)`);
        continue;
      }

      writeProject(p);
      migrated++;
      results.push(`${slug}: migrated`);
    } catch {
      skipped++;
      results.push(`${slug}: skipped (read/write error)`);
    }
  }

  ok({ migrated, skipped, results });
}

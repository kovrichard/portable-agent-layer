import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { storeDir } from "./bronze";

export interface ImportLogEntry {
  ts: string;
  archive: string;
  mode: "merge" | "overwrite";
  created: number;
  merged: number;
  identical: number;
  conflicts: number;
  skipped: number;
  linesAdded: number;
  quarantineDir: string | null;
  sourceMachineId?: string | null;
}

/** Append one record per import so a merged corpus stays attributable. */
export function appendImportLog(home: string, entry: ImportLogEntry): void {
  const logPath = resolve(storeDir("import-log", home), "import-log.jsonl");
  const line = `${JSON.stringify(entry)}\n`;

  if (existsSync(logPath)) {
    writeFileSync(logPath, readFileSync(logPath, "utf-8") + line);

    return;
  }

  writeFileSync(logPath, line);
}

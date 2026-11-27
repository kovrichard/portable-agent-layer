import { appendFileSync } from "node:fs";
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
  appendFileSync(
    resolve(storeDir("import-log", home), "import-log.jsonl"),
    `${JSON.stringify(entry)}\n`
  );
}

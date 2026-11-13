import { readdirSync, rmdirSync } from "node:fs";

export interface MigrationResult {
  migrated: number;
  skipped: number;
  results: string[];
}

export interface Migration {
  id: string;
  description: string;
  check(): { pending: boolean; detail?: string };
  run(dryRun?: boolean): MigrationResult;
  /** Moves its sources rather than copying them, so there is nothing left to delete. */
  movesSources?: true;
}

export function discardEmptyFolder(dir: string): void {
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    /* left in place — never worth failing a migration over */
  }
}

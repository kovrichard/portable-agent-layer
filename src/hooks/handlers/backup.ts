/**
 * Stop handler: automatic weekly backup.
 * Creates a zip of all gitignored personal files if the last backup
 * is older than 7 days, or if no backup exists yet.
 */

import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { exportZip, timestamp } from "../lib/export";
import { logDebug } from "../lib/log";
import { paths } from "../lib/paths";

const BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function autoBackup(): Promise<void> {
  const backupDir = paths.backups();

  // Check most recent backup
  const existing = (await readdir(backupDir))
    .filter((f) => f.startsWith("pal-backup-") && f.endsWith(".zip"))
    .sort()
    .reverse();

  if (existing.length > 0) {
    const latestPath = resolve(backupDir, existing[0]);
    const latestMtime = (await stat(latestPath)).mtimeMs;
    if (Date.now() - latestMtime < BACKUP_INTERVAL_MS) {
      logDebug("backup", "Skipping — last backup is less than 7 days old");
      return;
    }
  }

  const outputPath = resolve(backupDir, `pal-backup-${timestamp()}.zip`);
  const count = exportZip(outputPath);

  if (count === 0) {
    logDebug("backup", "Nothing to back up");
  } else {
    logDebug("backup", `Backed up ${count} files → ${outputPath}`);
  }
}

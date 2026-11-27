import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { palHome, paths } from "../../core/paths";
import { filesUnder, sha256Of } from "./file-hash";
import { backupStamp } from "./move-manifest";
import { recordMemoryMove } from "./verified-move";

export interface BackupReport {
  ok: boolean;
  archive: string;
  files: number;
  reason?: string;
  error?: string;
  differ: string[];
}

interface CommandResult {
  status: number | null;
  stderr: string;
}

export type TarRunner = (args: string[], cwd: string) => CommandResult;

const runTar: TarRunner = (args, cwd) => {
  const result = spawnSync("tar", args, { cwd, encoding: "utf-8", windowsHide: true });

  return { status: result.status, stderr: result.stderr ?? String(result.error ?? "") };
};

function existingDataRoots(): string[] {
  return paths.dataRoots().filter((root) => existsSync(root));
}

function differingCopies(copy: string): { files: number; differ: string[] } {
  const home = palHome();
  const originals = existingDataRoots().flatMap((root) => filesUnder(root));
  const differ = originals
    .map((file) => relative(home, file))
    .filter((file) => {
      const copied = resolve(copy, file);

      return !existsSync(copied) || sha256Of(copied) !== sha256Of(resolve(home, file));
    });

  return { files: originals.length, differ };
}

function refusedBackup(archive: string, reason: string, error: string): BackupReport {
  recordMemoryMove(
    "memory-backup",
    { outcome: "refused", reason, archive: basename(archive) },
    { error }
  );

  return { ok: false, archive, files: 0, reason, error, differ: [] };
}

function tarFailure(run: TarRunner, args: string[], cwd: string): string | null {
  const result = run(args, cwd);

  return result.status === 0
    ? null
    : result.stderr.trim() || `tar exited ${result.status}`;
}

function verifiedAgainstCopy(archive: string, verifyDir: string): BackupReport {
  const { files, differ } = differingCopies(verifyDir);
  if (differ.length > 0) {
    recordMemoryMove(
      "memory-backup",
      {
        outcome: "refused",
        reason: "backup differs",
        files,
        differ: differ.length,
        archive: basename(archive),
      },
      { differ }
    );

    return { ok: false, archive, files, reason: "backup differs", differ };
  }

  recordMemoryMove("memory-backup", {
    outcome: "backed-up",
    files,
    bytes: statSync(archive).size,
    archive: basename(archive),
  });

  return { ok: true, archive, files, differ: [] };
}

/**
 * Archives every data folder under ~/.pal/backups, extracts the archive beside it,
 * and compares every file's hash with the original. Only an ok report may lead to a move.
 */
export function backupDataVerified(run: TarRunner = runTar): BackupReport {
  const home = palHome();
  const name = `data-${backupStamp()}`;
  const archive = resolve(paths.backups(), `${name}.tar`);
  const verifyDir = resolve(paths.backups(), `${name}.verify`);

  const archiveError = tarFailure(
    run,
    [
      "-cf",
      basename(archive),
      "-C",
      home,
      ...existingDataRoots().map((root) => basename(root)),
    ],
    dirname(archive)
  );
  if (archiveError) return refusedBackup(archive, "archive failed", archiveError);

  mkdirSync(verifyDir, { recursive: true });

  try {
    const extractError = tarFailure(
      run,
      ["-xf", basename(archive), "-C", basename(verifyDir)],
      dirname(archive)
    );
    if (extractError) return refusedBackup(archive, "extract failed", extractError);

    return verifiedAgainstCopy(archive, verifyDir);
  } finally {
    rmSync(verifyDir, { recursive: true, force: true });
  }
}

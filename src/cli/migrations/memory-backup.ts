import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { paths } from "../../core/paths";
import { filesUnder, sha256Of } from "./file-hash";
import { backupStamp } from "./move-manifest";
import { recordMemoryMove } from "./verified-move";

export interface BackupReport {
  ok: boolean;
  archive: string;
  files: number;
  reason?: string;
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

function differingCopies(
  memory: string,
  copy: string
): { files: number; differ: string[] } {
  const originals = filesUnder(memory);
  const differ = originals
    .map((file) => relative(memory, file))
    .filter((file) => {
      const copied = resolve(copy, file);

      return !existsSync(copied) || sha256Of(copied) !== sha256Of(resolve(memory, file));
    });

  return { files: originals.length, differ };
}

function refusedBackup(
  archive: string,
  reason: string,
  detail: Record<string, unknown>
): BackupReport {
  recordMemoryMove(
    "memory-backup",
    { outcome: "refused", reason, archive: basename(archive) },
    detail
  );

  return { ok: false, archive, files: 0, reason, differ: [] };
}

function tarFailure(run: TarRunner, args: string[], cwd: string): string | null {
  const result = run(args, cwd);

  return result.status === 0
    ? null
    : result.stderr.trim() || `tar exited ${result.status}`;
}

function verifiedAgainstCopy(archive: string, verifyDir: string): BackupReport {
  const memory = paths.memory();
  const { files, differ } = differingCopies(memory, resolve(verifyDir, basename(memory)));
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
 * Archives all of memory/ under ~/.pal/backups, extracts the archive beside it,
 * and compares every file's hash with the original. Only an ok report may lead to a move.
 */
export function backupMemoryVerified(run: TarRunner = runTar): BackupReport {
  const memory = paths.memory();
  const name = `memory-${backupStamp()}`;
  const archive = resolve(paths.backups(), `${name}.tar`);
  const verifyDir = resolve(paths.backups(), `${name}.verify`);

  const archiveError = tarFailure(
    run,
    ["-cf", basename(archive), "-C", dirname(memory), basename(memory)],
    dirname(archive)
  );
  if (archiveError)
    return refusedBackup(archive, "archive failed", { error: archiveError });

  mkdirSync(verifyDir, { recursive: true });

  try {
    const extractError = tarFailure(
      run,
      ["-xf", basename(archive), "-C", basename(verifyDir)],
      dirname(archive)
    );
    if (extractError)
      return refusedBackup(archive, "extract failed", { error: extractError });

    return verifiedAgainstCopy(archive, verifyDir);
  } finally {
    rmSync(verifyDir, { recursive: true, force: true });
  }
}

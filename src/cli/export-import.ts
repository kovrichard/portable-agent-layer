import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type AdmZipArchive from "adm-zip";
import {
  appendImportLog,
  mergeArchive,
  readManifest,
  summarize,
} from "../hooks/lib/import-merge";
import { logDebug } from "../hooks/lib/log";
import { ensureRegistered, writeRegistryEntry } from "../hooks/lib/machine";
import { palHome, toPath } from "../hooks/lib/paths";
import { log } from "../targets/log";

export async function exportState(args: string[]) {
  const { collectExportFiles, exportZip, timestamp } = await import(
    "../hooks/lib/export"
  );

  const dryRun = args.includes("--dry-run");
  const outputPath = exportOutputPath(args, `pal-export-${timestamp()}.zip`);

  logDebug("export", `start dryRun=${dryRun} outputPath=${outputPath}`);

  if (dryRun) printExportDryRun(collectExportFiles(), outputPath);
  else reportExport(exportZip(outputPath), outputPath);
}

function exportOutputPath(args: string[], archiveName: string): string {
  const pathArg = args.find((a) => !a.startsWith("-"));
  const resolvedArg = pathArg ? toPath(pathArg) : null;

  if (resolvedArg === null) return resolve(palHome(), archiveName);

  const argIsDir = existsSync(resolvedArg) && statSync(resolvedArg).isDirectory();

  return argIsDir ? resolve(resolvedArg, archiveName) : resolvedArg;
}

function printExportDryRun(files: string[], outputPath: string): void {
  logDebug("export", `dry-run collected ${files.length} files`);

  if (files.length === 0) {
    console.log("Nothing to export.");

    return;
  }

  console.log(`Would export ${files.length} files → ${outputPath}\n`);

  for (const f of files) console.log(`  ${f}`);
}

function reportExport(count: number, outputPath: string): void {
  logDebug("export", `done count=${count} path=${outputPath}`);
  console.log(
    count === 0 ? "Nothing to export." : `Exported ${count} files → ${outputPath}`
  );
}

function findLatestArchiveIn(dirs: string[]): string | null {
  const candidates: string[] = [];

  for (const dir of dirs) {
    try {
      candidates.push(
        ...readdirSync(dir)
          .filter(
            (f) =>
              (f.startsWith("pal-export-") || f.startsWith("pal-backup-")) &&
              f.endsWith(".zip")
          )
          .map((f) => resolve(dir, f))
      );
    } catch {
      /* empty */
    }
  }

  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

type AdmZipClass = new (path: string) => { getEntries(): unknown[] };

/** An explicit file is taken as given; a folder or no argument picks the newest archive and asks first. */
async function chooseImportArchive(
  pathArg: string | undefined,
  home: string,
  AdmZip: AdmZipClass
): Promise<string> {
  const resolvedArg = pathArg ? toPath(pathArg) : null;
  const argIsDir =
    resolvedArg !== null &&
    existsSync(resolvedArg) &&
    statSync(resolvedArg).isDirectory();

  if (resolvedArg && !argIsDir) {
    logDebug("import", `using provided path=${resolvedArg}`);

    return resolvedArg;
  }

  const searchDirs = argIsDir ? [resolvedArg] : [home, resolve(home, "backups")];
  logDebug("import", `searching dirs=${searchDirs.join(",")}`);
  const latest = findLatestArchiveIn(searchDirs);
  if (!latest) {
    logDebug("import", "no export/backup files found");
    log.error("No export or backup files found. Provide a path: pal cli import <path>");
    process.exit(1);
  }

  logDebug("import", `auto-selected latest=${latest}`);
  console.log(`Found: ${latest}`);
  const zip = new AdmZip(latest);
  console.log(
    `Contains ${zip.getEntries().length} files, created ${statSync(latest).mtime.toISOString().slice(0, 16).replace("T", " ")}`
  );

  if (!(await confirmImport())) {
    console.log("Cancelled.");
    process.exit(0);
  }

  return latest;
}

async function confirmImport(): Promise<boolean> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((res) =>
    rl.question("Import this file? [y/N] ", (a) => {
      rl.close();
      res(a);
    })
  );

  return answer.trim().toLowerCase() === "y";
}

export async function importState(args: string[]) {
  const AdmZip = (await import("adm-zip")).default;

  const home = palHome();
  const dryRun = args.includes("--dry-run");
  const overwrite = args.includes("--overwrite");
  const pathArg = args.find((a) => !a.startsWith("-"));
  logDebug("import", `start dryRun=${dryRun} pathArg=${pathArg ?? "(auto)"}`);

  const zipPath = await chooseImportArchive(pathArg, home, AdmZip);
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  if (entries.length === 0) {
    console.log("Archive is empty.");
    process.exit(0);
  }

  logDebug(
    "import",
    `zip=${zipPath} entries=${entries.length} dryRun=${dryRun} overwrite=${overwrite}`
  );

  if (dryRun) {
    printImportDryRun(entries, home, overwrite);

    return;
  }

  if (overwrite) {
    importByOverwrite(zip, entries, home, zipPath);

    return;
  }

  importByMerge(entries, home, zipPath);
}

type ZipEntry = AdmZipArchive.IZipEntry;

function printImportDryRun(entries: ZipEntry[], home: string, overwrite: boolean) {
  console.log(
    `Would ${overwrite ? "overwrite with" : "merge"} ${entries.length} files → ${home}\n`
  );

  for (const e of entries) console.log(`  ${e.entryName}`);
}

function importByOverwrite(
  zip: AdmZipArchive,
  entries: ZipEntry[],
  home: string,
  zipPath: string
) {
  zip.extractAllTo(home, true);
  logDebug("import", `done overwrote=${entries.length} to=${home}`);
  console.log(`Imported ${entries.length} files → ${home} (overwrite)`);
  appendImportLog(home, {
    ts: new Date().toISOString(),
    archive: zipPath,
    mode: "overwrite",
    created: 0,
    merged: 0,
    identical: 0,
    conflicts: 0,
    skipped: 0,
    linesAdded: 0,
    quarantineDir: null,
  });
  log.info("Run 'pal cli install' to re-register hooks.");
}

function importQuarantineDir(home: string): string {
  return resolve(
    home,
    "backups",
    `import-conflicts-${new Date()
      .toISOString()
      .replace(/[-:T.]/g, "")
      .slice(0, 14)}`
  );
}

function archiveEntriesOf(entries: ZipEntry[]) {
  return entries.map((e) => ({ path: e.entryName, data: () => e.getData() }));
}

function importByMerge(entries: ZipEntry[], home: string, zipPath: string) {
  ensureRegistered(home);
  const result = mergeArchive(archiveEntriesOf(entries), home, importQuarantineDir(home));
  const source = readManifest(archiveEntriesOf(entries));
  if (source) {
    writeRegistryEntry({ id: source.machineId, label: source.label, os: source.os });
    console.log(`Source machine: ${source.label} (${source.machineId})`);
  }

  appendImportLog(home, {
    ts: new Date().toISOString(),
    archive: zipPath,
    mode: "merge",
    created: result.created.length,
    merged: result.merged.length,
    identical: result.identical.length,
    conflicts: result.conflicts.length,
    skipped: result.skipped.length,
    linesAdded: result.linesAdded,
    quarantineDir: result.quarantineDir,
    sourceMachineId: source?.machineId ?? null,
  });

  logDebug("import", `done merge ${summarize(result)} to=${home}`);
  console.log(`Imported → ${home}: ${summarize(result)}`);

  if (result.conflicts.length > 0) {
    log.warn(
      `${result.conflicts.length} file(s) diverged — local kept, incoming saved to ${result.quarantineDir}`
    );

    for (const c of result.conflicts) console.log(`  ${c}`);
  }

  log.info("Run 'pal cli install' to re-register hooks.");
}

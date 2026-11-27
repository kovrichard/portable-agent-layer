/**
 * PAL's own gzipped copy of every Claude Code transcript, taken before Claude
 * Code's cleanupPeriodDays (30 days by default) deletes the originals.
 */

import { spawn } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { logDebug, logError } from "../core/log";
import { assets, ensureDir, paths, platform } from "../core/paths";
import { storeLocation } from "./bronze";

const STALE_LOCK_MS = 30 * 60 * 1000;

export interface PreserveResult {
  copied: number;
  unchanged: number;
  failed: number;
}

interface PreserveLocations {
  source: string;
  target: string;
  manifest: string;
}

type Manifest = Record<string, string>;

export const transcriptArchive = () => storeLocation("transcripts");

function defaultLocations(): PreserveLocations {
  return {
    source: resolve(platform.claudeDir(), "projects"),
    target: transcriptArchive(),
    manifest: resolve(paths.state(), "transcript-copies.json"),
  };
}

function readManifest(path: string): Manifest {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Manifest;
  } catch {
    return {};
  }
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
}

function versionOf(file: string): string {
  const stat = statSync(file);

  return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
}

/** Streamed, so a gigabyte transcript never sits in memory; renamed into place, so a killed copy leaves the old one whole. */
async function gzipCopy(file: string, destination: string): Promise<void> {
  ensureDir(dirname(destination));
  const partial = `${destination}.partial`;

  try {
    await pipeline(createReadStream(file), createGzip(), createWriteStream(partial));
    await rename(partial, destination);
  } finally {
    await rm(partial, { force: true });
  }
}

const MANIFEST_SAVE_MS = 5_000;

function saveManifest(at: PreserveLocations, manifest: Manifest): void {
  ensureDir(dirname(at.manifest));
  writeFileSync(at.manifest, JSON.stringify(manifest), "utf-8");
}

export function preserveTranscripts(at: PreserveLocations): Promise<PreserveResult> {
  return preserveFiles(at, filesUnder(at.source));
}

function isUnder(dir: string, file: string): boolean {
  const rel = relative(dir, file);

  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

/** The session's transcript and the folder beside it, which holds its subagents' transcripts. */
function sessionFiles(transcriptPath: string): string[] {
  const own = existsSync(transcriptPath) ? [transcriptPath] : [];

  return [...own, ...filesUnder(transcriptPath.replace(/\.jsonl$/, ""))];
}

const keyOf = (dir: string, file: string) => relative(dir, file).replaceAll("\\", "/");

export const stagingDir = (at: PreserveLocations) => resolve(at.target, ".staging");

const STAGED_NAME = /^(.+)~(\d+)-(\d+)$/;

const stagedPath = (at: PreserveLocations, key: string, version: string) =>
  resolve(stagingDir(at), `${key}~${version.replace(":", "-")}`);

function stageCopy(file: string, destination: string): void {
  ensureDir(dirname(destination));
  const partial = `${destination}.partial`;

  try {
    copyFileSync(file, partial);
    renameSync(partial, destination);
  } finally {
    rmSync(partial, { force: true });
  }
}

/**
 * Copies one closing session's transcripts, uncompressed, in the closing process
 * itself: whatever stops the session's process group (a systemd unit ending, a
 * container exiting) stops the detached sweep with it. A plain copy fits the
 * agent's session-end budget; the sweep gzips the staged copy later.
 */
export function stageSessionTranscript(
  transcriptPath: string | undefined,
  at: PreserveLocations = defaultLocations()
): PreserveResult | null {
  if (!transcriptPath?.endsWith(".jsonl") || !isUnder(at.source, transcriptPath))
    return null;

  try {
    const manifest = readManifest(at.manifest);
    const result: PreserveResult = { copied: 0, unchanged: 0, failed: 0 };

    for (const file of sessionFiles(transcriptPath)) {
      try {
        const key = keyOf(at.source, file);
        const version = versionOf(file);
        if (manifest[key] === version) {
          result.unchanged++;
          continue;
        }

        stageCopy(file, stagedPath(at, key, version));
        result.copied++;
      } catch (err) {
        result.failed++;
        logError("transcript-preserve:stage", err);
      }
    }

    return result;
  } catch (err) {
    logError("transcript-preserve:session", err);

    return null;
  }
}

interface Staged {
  path: string;
  key: string;
  version: string;
}

function stagedFiles(at: PreserveLocations): Staged[] {
  return filesUnder(stagingDir(at)).flatMap((path) => {
    const match = keyOf(stagingDir(at), path).match(STAGED_NAME);

    return match ? [{ path, key: match[1], version: `${match[2]}:${match[3]}` }] : [];
  });
}

const mtimeOf = (version: string | undefined) => Number(version?.split(":")[1] ?? -1);

/** An archived copy at least as new, or a live original that changed since, makes the staged copy redundant. */
function stageSuperseded(at: PreserveLocations, manifest: Manifest, staged: Staged) {
  if (mtimeOf(manifest[staged.key]) >= mtimeOf(staged.version)) return true;
  const original = resolve(at.source, staged.key);

  return existsSync(original) && versionOf(original) !== staged.version;
}

function removeAbandonedPartials(at: PreserveLocations, now = Date.now()): void {
  for (const file of filesUnder(stagingDir(at))) {
    if (file.endsWith(".partial") && now - statSync(file).mtimeMs > STALE_LOCK_MS)
      rmSync(file, { force: true });
  }
}

function manifestSaver(at: PreserveLocations, manifest: Manifest): () => void {
  let savedAt = Date.now();

  return () => {
    if (Date.now() - savedAt <= MANIFEST_SAVE_MS) return;
    saveManifest(at, manifest);
    savedAt = Date.now();
  };
}

async function finishStaged(
  at: PreserveLocations,
  manifest: Manifest,
  result: PreserveResult,
  saveNow: () => void
): Promise<void> {
  for (const staged of stagedFiles(at)) {
    saveNow();

    try {
      if (stageSuperseded(at, manifest, staged)) result.unchanged++;
      else {
        await gzipCopy(staged.path, resolve(at.target, `${staged.key}.gz`));
        manifest[staged.key] = staged.version;
        result.copied++;
      }

      await rm(staged.path, { force: true });
    } catch (err) {
      result.failed++;
      logError("transcript-preserve:staged", err);
    }
  }
}

/** Staged copies first, so an original they hold is then unchanged; the manifest is saved every few seconds too, so a sweep stopped halfway does not copy everything again. */
async function preserveFiles(
  at: PreserveLocations,
  files: string[]
): Promise<PreserveResult> {
  const manifest = readManifest(at.manifest);
  const result: PreserveResult = { copied: 0, unchanged: 0, failed: 0 };
  const saveNow = manifestSaver(at, manifest);

  removeAbandonedPartials(at);
  await finishStaged(at, manifest, result, saveNow);

  for (const file of files) {
    saveNow();
    const key = keyOf(at.source, file);

    try {
      const version = versionOf(file);
      if (manifest[key] === version) {
        result.unchanged++;
        continue;
      }

      await gzipCopy(file, resolve(at.target, `${key}.gz`));
      manifest[key] = version;
      result.copied++;
    } catch (err) {
      result.failed++;
      logError("transcript-preserve", err);
    }
  }

  saveManifest(at, manifest);

  return result;
}

function lockPath(): string {
  return resolve(paths.state(), "transcript-preserve.lock");
}

function takeLock(path: string, now = Date.now()): boolean {
  if (existsSync(path) && now - statSync(path).mtimeMs < STALE_LOCK_MS) return false;
  rmSync(path, { force: true });

  try {
    closeSync(openSync(path, "wx"));

    return true;
  } catch {
    return false;
  }
}

export async function preserveTranscriptsOnce(
  at: PreserveLocations = defaultLocations()
): Promise<PreserveResult | null> {
  const lock = lockPath();
  if (!takeLock(lock)) return null;

  try {
    return await preserveTranscripts(at);
  } finally {
    await rm(lock, { force: true });
  }
}

export function spawnTranscriptPreserve(): void {
  try {
    const child = spawn("bun", [resolve(assets.hooks(), "PreserveTranscripts.ts")], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    logDebug("transcript-preserve", "detached copy spawned");
  } catch (err) {
    logError("transcript-preserve:spawn", err);
  }
}

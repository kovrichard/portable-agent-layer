/**
 * PAL's own gzipped copy of every Claude Code transcript, taken before Claude
 * Code's cleanupPeriodDays (30 days by default) deletes the originals.
 */

import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { logDebug, logError } from "./log";
import { assets, ensureDir, paths, platform } from "./paths";

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

function defaultLocations(): PreserveLocations {
  return {
    source: resolve(platform.claudeDir(), "projects"),
    target: resolve(paths.content(), "claude"),
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

function gzipCopy(file: string, destination: string): void {
  ensureDir(dirname(destination));
  writeFileSync(destination, Bun.gzipSync(readFileSync(file)));
}

export function preserveTranscripts(at: PreserveLocations): PreserveResult {
  const manifest = readManifest(at.manifest);
  const result: PreserveResult = { copied: 0, unchanged: 0, failed: 0 };
  for (const file of filesUnder(at.source)) {
    const key = relative(at.source, file).replaceAll("\\", "/");
    try {
      const version = versionOf(file);
      if (manifest[key] === version) {
        result.unchanged++;
        continue;
      }
      gzipCopy(file, resolve(at.target, `${key}.gz`));
      manifest[key] = version;
      result.copied++;
    } catch (err) {
      result.failed++;
      logError("transcript-preserve", err);
    }
  }
  ensureDir(dirname(at.manifest));
  writeFileSync(at.manifest, JSON.stringify(manifest), "utf-8");
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

export function preserveTranscriptsOnce(
  at: PreserveLocations = defaultLocations()
): PreserveResult | null {
  const lock = lockPath();
  if (!takeLock(lock)) return null;
  try {
    return preserveTranscripts(at);
  } finally {
    rmSync(lock, { force: true });
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

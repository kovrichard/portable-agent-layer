/**
 * Update checker — detects if a newer version of PAL is available.
 *
 * Repo mode: auto-detected when a .git directory exists at palPkg() root.
 * Package mode: fallback when no .git is present (global bun install).
 *
 * Caches result in cache/update-available.json. Checked at most once per hour.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug } from "../../core/log";
import { palPkg, paths } from "../../core/paths";
import { raw as rawSettings, write as writeSettings } from "../../core/settings";

export interface UpdateCache {
  checkedAt: string;
  available: boolean;
  current: string;
  latest: string;
  mode: "repo" | "package";
  /** Set by the check so the statusline scripts need no version logic of their own. */
  major?: boolean;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cachePath(): string {
  return resolve(paths.cache(), "update-available.json");
}

/** The last check's result whatever its age — the notice and the page read this, not the TTL. */
export function cachedStatus(): UpdateCache | null {
  try {
    const fp = cachePath();
    if (!existsSync(fp)) return null;

    return JSON.parse(readFileSync(fp, "utf-8")) as UpdateCache;
  } catch {
    return null;
  }
}

function readCache(): UpdateCache | null {
  const cache = cachedStatus();
  if (!cache) return null;
  const fresh = Date.now() - new Date(cache.checkedAt).getTime() < CACHE_TTL_MS;

  return fresh ? cache : null;
}

function writeCache(cache: UpdateCache): void {
  try {
    writeFileSync(cachePath(), JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    /* non-critical */
  }
}

export function isRepoMode(): boolean {
  return existsSync(resolve(palPkg(), ".git"));
}

export function getInstalledVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(palPkg(), "package.json"), "utf-8"));

    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const PULLED_BRANCH = "@{upstream}";

async function gitOutput(repoDir: string, args: string[]): Promise<string> {
  const git = Bun.spawn(["git", ...args], {
    cwd: repoDir,
    stdout: "pipe",
    stderr: "ignore",
    windowsHide: true,
  });

  return await new Response(git.stdout).text();
}

async function gitFetch(repoDir: string): Promise<void> {
  const fetch = Bun.spawn(["git", "fetch", "--quiet"], {
    cwd: repoDir,
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
  await fetch.exited;
}

// "Ahead" (local unpushed commits) is not an update — only remote commits we
// lack are. Count HEAD..upstream so being ahead or diverged never nags.
async function commitsBehind(repoDir: string): Promise<number> {
  const count = await gitOutput(repoDir, [
    "rev-list",
    "--count",
    `HEAD..${PULLED_BRANCH}`,
  ]);

  return Number.parseInt(count.trim(), 10) || 0;
}

async function upstreamVersion(
  repoDir: string,
  current: string,
  remoteHash: string
): Promise<string> {
  try {
    const remotePkg = JSON.parse(
      await gitOutput(repoDir, ["show", `${PULLED_BRANCH}:package.json`])
    );

    return remotePkg.version || current;
  } catch {
    return `${remoteHash.slice(0, 7)} (ahead)`;
  }
}

async function checkRepo(): Promise<UpdateCache> {
  const repoDir = palPkg();
  const current = getInstalledVersion();

  try {
    await gitFetch(repoDir);
    const remoteHash = (await gitOutput(repoDir, ["rev-parse", PULLED_BRANCH])).trim();
    const behindCount = await commitsBehind(repoDir);
    const available = behindCount > 0 && remoteHash.length > 0;
    const latest = available
      ? await upstreamVersion(repoDir, current, remoteHash)
      : current;

    return {
      checkedAt: new Date().toISOString(),
      available,
      current,
      latest,
      mode: "repo",
    };
  } catch {
    return {
      checkedAt: new Date().toISOString(),
      available: false,
      current,
      latest: current,
      mode: "repo",
    };
  }
}

/** npm's latest tag lags a fresh release by seconds; an older latest is never an update. */
export function isNewerRelease(latest: string, current: string): boolean {
  return Bun.semver.order(latest, current) === 1;
}

export const MAJOR_UPDATE_COMMAND = "pal cli update --major";

function majorOf(version: string): number | null {
  const major = /^(\d+)\./.exec(version)?.[1];

  return major === undefined ? null : Number(major);
}

/** A release in a later major than the installed one: installed only when the user asks. */
export function startsNewMajor(update: UpdateCache): boolean {
  const from = majorOf(update.current);
  const to = majorOf(update.latest);

  return update.available && from !== null && to !== null && to > from;
}

/** latest is the stable release from main; canary is the prerelease from the canary branch. */
export type Channel = "latest" | "canary";

export async function checkNpm(
  channel: Channel = "latest",
  fetchImpl: typeof fetch = fetch
): Promise<UpdateCache> {
  const current = getInstalledVersion();

  try {
    const response = await fetchImpl(
      `https://registry.npmjs.org/portable-agent-layer/${channel}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { version?: string };
    const latest = data.version || current;

    return {
      checkedAt: new Date().toISOString(),
      available: isNewerRelease(latest, current),
      current,
      latest,
      mode: "package",
    };
  } catch {
    return {
      checkedAt: new Date().toISOString(),
      available: false,
      current,
      latest: current,
      mode: "package",
    };
  }
}

/** Which releases a package install follows; set by `pal cli update --canary` / `--stable`. */
export type UpdateChannel = "stable" | "canary";

export function updateChannel(): UpdateChannel {
  return rawSettings().updateChannel === "canary" ? "canary" : "stable";
}

export function setUpdateChannel(channel: UpdateChannel): void {
  writeSettings({ ...rawSettings(), updateChannel: channel });
}

export function checkPackage(
  channel: UpdateChannel,
  fetchImpl: typeof fetch = fetch
): Promise<UpdateCache> {
  return checkNpm(channel === "canary" ? "canary" : "latest", fetchImpl);
}

/** Run update check. Caches result. Use force=true to skip cache (e.g. for `pal cli update`). */
export async function checkForUpdate(
  force = false,
  channel: UpdateChannel = updateChannel(),
  fetchImpl: typeof fetch = fetch
): Promise<UpdateCache> {
  if (!force) {
    const cached = readCache();
    if (cached) {
      logDebug("update-check", "Using cached result");

      return cached;
    }
  }

  const checked = isRepoMode()
    ? await checkRepo()
    : await checkPackage(channel, fetchImpl);
  const result = { ...checked, major: startsNewMajor(checked) };
  writeCache(result);

  if (result.available) {
    logDebug(
      "update-check",
      `Update available: ${result.current} → ${result.latest} (${result.mode})`
    );
  }

  return result;
}

/** Invalidate the cached update status — call after a successful update so the notice clears immediately. */
export function clearUpdateCache(): void {
  try {
    rmSync(cachePath(), { force: true });
  } catch {
    /* non-critical */
  }
}

/** Read cached update status for greeting display. Returns null if no update. */
export function getUpdateNotice(): string | null {
  const cache = cachedStatus();
  if (!cache?.available) return null;

  if (startsNewMajor(cache))
    return `📦 PAL ${cache.latest} is a new major release, installed only on request: ${MAJOR_UPDATE_COMMAND}`;

  return `📦 Update available: ${cache.current} → ${cache.latest} (pal cli update)`;
}

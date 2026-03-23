/**
 * Update checker — detects if a newer version of PAL is available.
 *
 * Repo mode (.palroot exists): git fetch + compare HEAD vs origin/main
 * Package mode: fetch npm registry for latest version vs installed
 *
 * Caches result in state/update-available.json. Checked at most once per hour.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug } from "../lib/log";
import { ensureDir, palPkg, paths } from "../lib/paths";

interface UpdateCache {
  checkedAt: string;
  available: boolean;
  current: string;
  latest: string;
  mode: "repo" | "package";
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cachePath(): string {
  return resolve(ensureDir(paths.state()), "update-available.json");
}

function readCache(): UpdateCache | null {
  try {
    const fp = cachePath();
    if (!existsSync(fp)) return null;
    const cache = JSON.parse(readFileSync(fp, "utf-8")) as UpdateCache;
    if (Date.now() - new Date(cache.checkedAt).getTime() < CACHE_TTL_MS) return cache;
    return null; // expired
  } catch {
    return null;
  }
}

function writeCache(cache: UpdateCache): void {
  try {
    writeFileSync(cachePath(), JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    /* non-critical */
  }
}

function isRepoMode(): boolean {
  return existsSync(resolve(palPkg(), ".palroot"));
}

function getInstalledVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(palPkg(), "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function checkRepo(): Promise<UpdateCache> {
  const repoDir = palPkg();
  const current = getInstalledVersion();

  try {
    const fetch = Bun.spawn(["git", "fetch", "--quiet"], {
      cwd: repoDir,
      stdout: "ignore",
      stderr: "ignore",
    });
    await fetch.exited;

    const local = Bun.spawn(["git", "rev-parse", "HEAD"], {
      cwd: repoDir,
      stdout: "pipe",
      stderr: "ignore",
    });
    const localHash = (await new Response(local.stdout).text()).trim();

    const remote = Bun.spawn(["git", "rev-parse", "origin/main"], {
      cwd: repoDir,
      stdout: "pipe",
      stderr: "ignore",
    });
    const remoteHash = (await new Response(remote.stdout).text()).trim();

    const available = localHash !== remoteHash && remoteHash.length > 0;

    // Get remote version from package.json on origin/main
    let latest = current;
    if (available) {
      try {
        const show = Bun.spawn(["git", "show", "origin/main:package.json"], {
          cwd: repoDir,
          stdout: "pipe",
          stderr: "ignore",
        });
        const remotePkg = JSON.parse(await new Response(show.stdout).text());
        latest = remotePkg.version || current;
      } catch {
        latest = `${remoteHash.slice(0, 7)} (ahead)`;
      }
    }

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

async function checkNpm(): Promise<UpdateCache> {
  const current = getInstalledVersion();

  try {
    const response = await fetch(
      "https://registry.npmjs.org/portable-agent-layer/latest",
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { version?: string };
    const latest = data.version || current;

    return {
      checkedAt: new Date().toISOString(),
      available: latest !== current,
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

/** Run update check. Caches result. Use force=true to skip cache (e.g. for `pal cli update`). */
export async function checkForUpdate(force = false): Promise<UpdateCache> {
  if (!force) {
    const cached = readCache();
    if (cached) {
      logDebug("update-check", "Using cached result");
      return cached;
    }
  }

  const result = isRepoMode() ? await checkRepo() : await checkNpm();
  writeCache(result);

  if (result.available) {
    logDebug(
      "update-check",
      `Update available: ${result.current} → ${result.latest} (${result.mode})`
    );
  }

  return result;
}

/** Read cached update status for greeting display. Returns null if no update. */
export function getUpdateNotice(): string | null {
  try {
    const fp = cachePath();
    if (!existsSync(fp)) return null;
    const cache = JSON.parse(readFileSync(fp, "utf-8")) as UpdateCache;
    if (!cache.available) return null;

    return `📦 Update available: ${cache.current} → ${cache.latest} (pal cli update)`;
  } catch {
    return null;
  }
}

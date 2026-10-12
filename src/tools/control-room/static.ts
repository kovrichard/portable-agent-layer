/**
 * The built page, off disk. Vite compiles src/tools/control-room/ui into
 * ui/dist; this serves it, and says so plainly when the build has not been run
 * rather than answering a blank page.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isInside } from "../../hooks/lib/paths";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const SOURCE_ROOT = resolve(REPO_ROOT, "src");
const UI_ROOT = resolve(import.meta.dir, "ui");
const UI_DIST = resolve(UI_ROOT, "dist");
const UI_INDEX = resolve(UI_DIST, "index.html");
const BUILD_LOCK = resolve(UI_ROOT, "dist.lock");
const ABANDONED_LOCK_MS = 120_000;

export const BUILD_COMMAND = "bun run build:ui";

export function isBuilt(): boolean {
  return existsSync(UI_INDEX);
}

function newestSourceChange(): number {
  const sources = readdirSync(SOURCE_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !isInside(UI_DIST, entry.parentPath))
    .map((entry) => resolve(entry.parentPath, entry.name));
  const lockfile = resolve(REPO_ROOT, "bun.lock");
  if (existsSync(lockfile)) sources.push(lockfile);
  return Math.max(...sources.map((file) => statSync(file).mtimeMs));
}

export function isUpToDate(): boolean {
  return isBuilt() && statSync(UI_INDEX).mtimeMs >= newestSourceChange();
}

function clearAbandonedLock(): void {
  try {
    if (Date.now() - statSync(BUILD_LOCK).mtimeMs > ABANDONED_LOCK_MS)
      rmSync(BUILD_LOCK, { recursive: true, force: true });
  } catch {}
}

function tryTakeBuildLock(): boolean {
  try {
    mkdirSync(BUILD_LOCK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function whileHoldingBuildLock(build: () => boolean): boolean {
  while (!tryTakeBuildLock()) {
    clearAbandonedLock();
    Bun.sleepSync(50);
  }
  try {
    return build();
  } finally {
    rmSync(BUILD_LOCK, { recursive: true, force: true });
  }
}

function runViteBuild(vite: string): boolean {
  const built = spawnSync(process.execPath, [vite, "build"], {
    cwd: UI_ROOT,
    encoding: "utf-8",
  });
  return built.status === 0 && isBuilt();
}

/**
 * A clone has vite; a published install has the prepacked dist and never needs
 * it. Either way the page is there by the time the server answers. vite empties
 * dist before writing it, so one build at a time, and none once another process
 * has already brought it up to date.
 */
export function buildPage(): boolean {
  // node_modules/.bin/vite is a shell shim that Windows cannot spawn directly;
  // the package's own JS entry runs the same build under any runtime.
  const vite = resolve(REPO_ROOT, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(vite)) return false;
  return whileHoldingBuildLock(() => isUpToDate() || runViteBuild(vite));
}

function unbuiltPage(): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>PAL control room</title>` +
      `<body style="font:14px system-ui;padding:3rem;max-width:34rem">` +
      `<h1>The page has not been built</h1>` +
      `<p>The control room's assets are a build artifact rather than source. Run:</p>` +
      `<pre style="background:#eee;padding:1rem">${BUILD_COMMAND}</pre></body>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export function indexHtml(): Response {
  if (!isBuilt()) return unbuiltPage();
  return new Response(Bun.file(resolve(UI_DIST, "index.html")), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Only what the build emitted, resolved inside dist — a request that climbs out
 * of it with `..` is a miss, not a file read.
 */
export function staticAsset(pathname: string): Response | null {
  const target = resolve(UI_DIST, `.${pathname}`);
  if (!isInside(UI_DIST, target)) return null;
  return existsSync(target) ? new Response(Bun.file(target)) : null;
}

/**
 * The built page, off disk. Vite compiles src/tools/control-room/ui into
 * ui/dist; this serves it, and says so plainly when the build has not been run
 * rather than answering a blank page.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const UI_DIST = resolve(import.meta.dir, "ui", "dist");

export const BUILD_COMMAND = "bun run build:ui";

export function isBuilt(): boolean {
  return existsSync(resolve(UI_DIST, "index.html"));
}

/**
 * A clone has vite; a published install has the prepacked dist and never needs
 * it. Either way the page is there by the time the server answers.
 */
export function buildPage(): boolean {
  const repoRoot = resolve(import.meta.dir, "..", "..", "..");
  const vite = resolve(repoRoot, "node_modules", ".bin", "vite");
  if (!existsSync(vite)) return false;
  const built = spawnSync(vite, ["build"], {
    cwd: resolve(import.meta.dir, "ui"),
    encoding: "utf-8",
  });
  return built.status === 0 && isBuilt();
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
  if (!target.startsWith(`${UI_DIST}/`)) return null;
  const file = Bun.file(target);
  return existsSync(target) ? new Response(file) : null;
}

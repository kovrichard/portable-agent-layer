/**
 * Cross-platform binary resolution — a manual PATH walk.
 *
 * Deliberately avoids Bun.which / a `which` subprocess because:
 * 1. Ubuntu 24.04 dropped the `which` binary entirely.
 * 2. Windows has no `which` at all.
 * 3. Bun.which snapshots PATH at startup and ignores mid-test mutations.
 * 4. Bun.spawn on Windows is inconsistent at resolving PATHEXT for bare
 *    names — passing the full `.cmd`/`.exe` path bypasses that fragility.
 */

import { accessSync, constants, statSync } from "node:fs";
import { delimiter, resolve as resolvePath } from "node:path";

/**
 * A directory carries the execute bit as "traversable", so X_OK alone accepts
 * a folder that happens to share a CLI's name. statSync follows symlinks, so a
 * linked binary still resolves. Windows has no executable bit — being a file
 * under a PATHEXT extension is all it can offer.
 */
function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    if (process.platform === "win32") return true;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a binary on PATH to its full absolute path, or null if absent. */
export function findBinaryOnPath(name: string): string | null {
  const PATH = process.env.PATH;
  if (!PATH) return null;
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];
  for (const dir of PATH.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = resolvePath(dir, name + ext);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

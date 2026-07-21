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

import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, resolve as resolvePath } from "node:path";

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
      try {
        if (process.platform === "win32") {
          // Windows has no executable bit — existence in PATHEXT is enough.
          if (existsSync(candidate)) return candidate;
        } else {
          accessSync(candidate, constants.X_OK);
          return candidate;
        }
      } catch {
        /* not here — try next */
      }
    }
  }
  return null;
}

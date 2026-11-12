import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Remove every `pal-*` context file with the given suffix from a directory.
 *
 * Globs rather than iterating getSemiStaticSources(): a slug retired from that
 * registry keeps its already-written file on disk, and a registry-driven delete
 * can no longer name it — agents then keep loading retired context forever.
 * Also catches the legacy pre-split filenames without needing a special case.
 */
export function removePalContextFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  const removed: string[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.startsWith("pal-") || !file.endsWith(suffix)) continue;
    try {
      unlinkSync(resolve(dir, file));
      removed.push(file);
    } catch {
      /* gone or not ours to remove */
    }
  }
  return removed;
}

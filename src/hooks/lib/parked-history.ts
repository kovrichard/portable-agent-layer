/**
 * History from a directory no project claimed is parked under the directory's
 * name. Once exactly one project is bound to a directory of that name, the
 * parked history is its own and moves in.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { mergeJsonlLines } from "./import-merge";
import { logError } from "./log";

type Bindings = Record<string, string>;

/** Union both sides so a destination that already has history keeps it. */
export function foldHistoryInto(target: string, source: string): number {
  const local = existsSync(target) ? readFileSync(target, "utf-8") : "";
  const { text, added } = mergeJsonlLines(local, readFileSync(source, "utf-8"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, "utf-8");
  return added;
}

/** The project bound to a directory named `slug`, when exactly one is. */
function projectBoundUnder(slug: string, bindings: Bindings): string | null {
  const owners = Object.entries(bindings).filter(([, path]) => basename(path) === slug);
  return owners.length === 1 ? owners[0][0] : null;
}

function parkedDir(home: string): string {
  return resolve(home, "memory", "state", "unbound-history");
}

function recordedProjectDir(home: string, project: string): string | null {
  const dir = resolve(home, "memory", "projects", project);
  return existsSync(resolve(dir, "ISA.md")) ? dir : null;
}

export function adoptParkedHistory(bindings: Bindings, home: string): void {
  const dir = parkedDir(home);
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    const owner = projectBoundUnder(file.slice(0, -".jsonl".length), bindings);
    const projectDir = owner && recordedProjectDir(home, owner);
    if (!projectDir) continue;
    try {
      foldHistoryInto(resolve(projectDir, "history.jsonl"), resolve(dir, file));
      unlinkSync(resolve(dir, file));
    } catch (err) {
      logError("parked-history:adopt", err);
    }
  }
}

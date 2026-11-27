/**
 * History from a directory no project claimed is parked under the directory's
 * name. Once exactly one project is bound to a directory of that name, the
 * parked history is its own and is copied in. The parked file stays: both
 * stores only grow, so two machines merge them line by line.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { storeDir, storeLocation } from "../bronze/bronze";
import { linesNotIn } from "../core/import-merge";
import { logError } from "../core/log";

type Bindings = Record<string, string>;

/** Appends the lines of `source` that `target` lacks. */
export function foldHistoryInto(target: string, source: string): number {
  const local = existsSync(target) ? readFileSync(target, "utf-8") : "";
  const added = linesNotIn(local, readFileSync(source, "utf-8"));
  if (added.length === 0) return 0;
  const separator = local === "" || local.endsWith("\n") ? "" : "\n";
  mkdirSync(dirname(target), { recursive: true });
  appendFileSync(target, `${separator}${added.join("\n")}\n`, "utf-8");

  return added.length;
}

/** The project bound to a directory named `slug`, when exactly one is. */
function projectBoundUnder(slug: string, bindings: Bindings): string | null {
  const owners = Object.entries(bindings).filter(([, path]) => basename(path) === slug);

  return owners.length === 1 ? owners[0][0] : null;
}

function recordedProjectDir(home: string, project: string): string | null {
  const dir = resolve(storeLocation("project-history", home), project);

  return existsSync(resolve(dir, "ISA.md")) ? dir : null;
}

function historyFileOf(home: string, project: string): string {
  return resolve(storeDir("project-history", home), project, "history.jsonl");
}

export function adoptParkedHistory(bindings: Bindings, home: string): void {
  const dir = storeDir("unbound-history", home);

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    const owner = projectBoundUnder(file.slice(0, -".jsonl".length), bindings);
    if (!owner || !recordedProjectDir(home, owner)) continue;

    try {
      foldHistoryInto(historyFileOf(home, owner), resolve(dir, file));
    } catch (err) {
      logError("parked-history:adopt", err);
    }
  }
}

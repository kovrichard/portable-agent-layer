import { existsSync, readFileSync } from "node:fs";
import * as hostPath from "node:path";
import { resolve } from "node:path";
import { palHome } from "./paths";

/** The path functions of one platform: the host's, or `path.win32` / `path.posix` in tests. */
export type PlatformPath = typeof hostPath.posix;

/** Project name → absolute path on this machine. */
export type Bindings = Record<string, string>;

export function bindingsFilePath(home: string = palHome()): string {
  return resolve(home, "bindings.json");
}

function isBindingMap(value: unknown): value is Bindings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  return Object.values(value).every((v) => typeof v === "string");
}

/**
 * A malformed or unreadable file reads as empty rather than throwing. Bindings
 * are a lookup aid, so a corrupt one degrades to "nothing is bound here" — the
 * same state a fresh machine starts in — instead of breaking every caller.
 */
export function readBindings(home: string = palHome()): Bindings {
  const file = bindingsFilePath(home);
  if (!existsSync(file)) return {};

  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
    if (!isBindingMap(parsed)) return {};

    return parsed;
  } catch {
    return {};
  }
}

/** The absolute path this machine has for `project`, or null when unbound. */
export function bindingFor(project: string, home: string = palHome()): string | null {
  return readBindings(home)[project] ?? null;
}

function foldCaseOnWindows(path: string, platform: PlatformPath): string {
  return platform.sep === "\\" ? path.toLowerCase() : path;
}

export function projectRootContaining(
  cwd: string,
  roots: Bindings,
  platform: PlatformPath = hostPath
): string | null {
  const cwdAbs = foldCaseOnWindows(platform.resolve(cwd), platform);
  const matches: { name: string; path: string }[] = [];

  for (const [name, root] of Object.entries(roots)) {
    const key = foldCaseOnWindows(platform.resolve(root), platform);
    if (cwdAbs === key || cwdAbs.startsWith(key + platform.sep))
      matches.push({ name, path: key });
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => b.path.length - a.path.length);

  return matches[0].name;
}

export function boundProjectAt(cwd: string): string | null {
  return projectRootContaining(cwd, readBindings());
}

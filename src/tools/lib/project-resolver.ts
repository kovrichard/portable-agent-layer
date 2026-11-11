/**
 * Names the project a usage call belongs to, from the working directory it
 * recorded. Every reader gets one resolver, so a folder is looked at once.
 */

import { existsSync } from "node:fs";
import * as hostPath from "node:path";
import type { Bindings } from "../../hooks/lib/bindings";
import {
  type PlatformPath,
  type ProjectProgress,
  resolveProjectFromCwd,
} from "../../hooks/lib/projects";
import { repoRootOf } from "../../hooks/lib/session-events";

export const UNKNOWN_PROJECT = "(unknown)";

export type ProjectResolver = (cwd: string | undefined) => string;

export function projectResolver(
  projects: ProjectProgress[],
  bindings: Bindings,
  paths: PlatformPath = hostPath
): ProjectResolver {
  const memo = new Map<string, string>();

  const nameOf = (cwd: string): string => {
    const registered = resolveProjectFromCwd(cwd, projects, bindings, paths);
    if (registered) return registered.name;
    if (!existsSync(cwd)) return UNKNOWN_PROJECT;
    const root = repoRootOf(cwd);
    if (root === null) return UNKNOWN_PROJECT;
    const rootProject = resolveProjectFromCwd(root, projects, bindings, paths);
    return rootProject ? rootProject.name : paths.basename(root);
  };

  return (cwd) => {
    if (!cwd) return UNKNOWN_PROJECT;
    let name = memo.get(cwd);
    if (name === undefined) {
      name = nameOf(cwd);
      memo.set(cwd, name);
    }
    return name;
  };
}

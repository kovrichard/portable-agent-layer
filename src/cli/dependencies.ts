import { unresolvedDependencies } from "./doctor/state";

/**
 * The `bun install` arguments that make PAL's dependencies resolve, or null when
 * they already do. A published package ships no lockfile, and `bun add -g` has
 * already installed its dependencies next to it.
 */
export function dependencyInstall(pkg: string, repoMode: boolean): string[] | null {
  if (repoMode) return ["install", "--frozen-lockfile"];
  return unresolvedDependencies(pkg).length > 0 ? ["install", "--production"] : null;
}

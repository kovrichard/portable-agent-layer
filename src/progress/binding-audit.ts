import { existsSync } from "node:fs";
import { type Bindings, readBindings } from "../core/project-bindings";
import { detectRemote } from "../core/remote";
import {
  type ProjectProgress,
  projectPathOnThisMachine,
  readAllProjects,
} from "./projects";

export type BindingIssue =
  | { kind: "missing"; project: string; path: string }
  | { kind: "orphan"; project: string; path: string; renamedTo?: string }
  | { kind: "shared"; path: string; projects: string[] };

/** An unbound project whose recorded remote is the repository at `path`: the orphan under a new name. */
function renamedProjectAt(
  path: string,
  projects: ProjectProgress[],
  bindings: Bindings
): string | undefined {
  const remote = detectRemote(path);

  return projects.find((p) => p.remote === remote && !(p.name in bindings) && !p.path)
    ?.name;
}

/** Bindings whose name no project carries, as a rename leaves behind. */
function orphanBindings(projects: ProjectProgress[], bindings: Bindings): BindingIssue[] {
  const names = new Set(projects.map((project) => project.name));

  return Object.entries(bindings)
    .filter(([name]) => !names.has(name))
    .map(([name, path]) => {
      const renamedTo = renamedProjectAt(path, projects, bindings);

      return { kind: "orphan", project: name, path, ...(renamedTo && { renamedTo }) };
    });
}

/**
 * Health of this machine's project bindings.
 *
 * A project with no checkout here is not an issue: sync brings every machine's
 * projects, and most live elsewhere. Opening a session in a checkout proposes
 * its binding. Three things can still go wrong: a binding can outlive the
 * directory it names; two projects can end up on one directory — the shape
 * that appears when a name is reused for a second checkout, where binding by
 * name alone would silently repoint the first; and a binding can outlive its
 * project, as a rename leaves it.
 *
 * Read-only by construction: it reports, it never repairs.
 */
export function auditBindings(
  projects: ProjectProgress[] = readAllProjects(),
  bindings: Bindings = readBindings()
): BindingIssue[] {
  const issues: BindingIssue[] = [];
  const byPath = new Map<string, string[]>();

  for (const project of projects) {
    const path = projectPathOnThisMachine(project, bindings);
    if (!path) continue;

    if (!existsSync(path)) {
      issues.push({ kind: "missing", project: project.name, path });
      continue;
    }

    byPath.set(path, [...(byPath.get(path) ?? []), project.name]);
  }

  for (const [path, names] of byPath) {
    if (names.length > 1) issues.push({ kind: "shared", path, projects: names.sort() });
  }

  return [...issues, ...orphanBindings(projects, bindings)];
}

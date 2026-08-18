/**
 * Path anchors — `{proj:slug}/relative` instead of an absolute path.
 *
 * An absolute cwd stamp never matches across machines: same project,
 * different mount, different username, different OS. An anchor replaces the
 * absolute prefix with the project's registry slug, so resolution happens
 * locally at read time — the same trick machine.ts uses for labels, applied
 * to paths. Relocating a project (`project.ts set-path`) then fixes every
 * memory that ever referenced it, because none of them stored the path.
 */

import { relative, resolve, sep } from "node:path";
import type { ProjectProgress } from "./projects";
import { readAllProjects, resolveProjectFromCwd } from "./projects";

const ANCHOR_RE = /^\{proj:([a-z0-9_-]+)\}(\/.*)?$/;

export function isAnchor(value: string): boolean {
  return ANCHOR_RE.test(value);
}

/**
 * Absolute path → `{proj:slug}/relative`, if it falls inside a registered
 * project. A path outside every registered project passes through
 * unchanged — most cwd stamps from ad hoc commands will never resolve to a
 * project, and that is fine; they simply do not benefit yet.
 */
export function encodeAnchor(
  absPath: string,
  projects: ProjectProgress[] = readAllProjects()
): string {
  const proj = resolveProjectFromCwd(absPath, projects);
  if (!proj) return absPath;

  // Defensive: resolveProjectFromCwd already guarantees absPath sits inside
  // proj.path, so this is unreachable today. Kept as a guard against that
  // contract changing rather than as covered behavior.
  const rel = relative(resolve(proj.path), resolve(absPath));
  if (rel.startsWith("..")) return absPath;

  const relPosix = rel.split(sep).join("/");
  return relPosix ? `{proj:${proj.name}}/${relPosix}` : `{proj:${proj.name}}`;
}

export type AnchorResolution =
  | { state: "anchored"; path: string }
  | { state: "plain"; path: string }
  | { state: "unresolvable"; slug: string };

/**
 * `{proj:slug}/relative` → absolute path on THIS machine, via the local
 * registry. A plain (non-anchor) value is returned as-is — either an
 * already-local absolute path, or a record captured before this feature
 * shipped. There is no backfill, so pre-anchor records are handled exactly
 * as they were before.
 */
export function resolveAnchor(
  value: string,
  projects: ProjectProgress[] = readAllProjects()
): AnchorResolution {
  const match = ANCHOR_RE.exec(value);
  if (!match) return { state: "plain", path: value };

  const [, slug, rel] = match;
  const proj = projects.find((p) => p.name === slug);
  if (!proj) return { state: "unresolvable", slug };

  const path = rel ? resolve(proj.path, `.${rel}`) : resolve(proj.path);
  return { state: "anchored", path };
}

/** Does `value` (anchored or plain) refer to `cwd` on this machine? */
export function anchorMatchesCwd(
  value: string,
  cwd: string,
  projects: ProjectProgress[] = readAllProjects()
): boolean {
  const resolved = resolveAnchor(value, projects);
  if (resolved.state === "unresolvable") return false;
  return resolve(resolved.path) === resolve(cwd);
}

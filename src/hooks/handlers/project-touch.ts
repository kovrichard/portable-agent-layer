/**
 * Stop handler: when cwd resolves to an active registered project, record on
 * this machine that it was just worked in; readProject folds it into `updated`.
 * Otherwise no-op (parent-dir browse mode, unregistered cwd, paused/complete/
 * archived projects all fall through cleanly).
 *
 * The plan calls for the JSONs to never go stale silently — this is the
 * mechanism. CLI invocation is for explicit edits; this handler is for the
 * "you were just working in this project" auto-bump.
 */

import { logDebug, logError } from "../../core/log";
import { recordProjectTouch } from "../../progress/project-activity";
import { readAllProjects, resolveProjectFromCwd } from "../../progress/projects";

export async function projectTouch(): Promise<void> {
  try {
    const projects = readAllProjects();
    if (projects.length === 0) return;

    const resolved = resolveProjectFromCwd(process.cwd(), projects);
    if (!resolved) return;

    if (resolved.status !== "active") return;

    recordProjectTouch(resolved.name);
    logDebug("project-touch", `bumped ${resolved.name} (${resolved.path})`);
  } catch (err) {
    logError("project-touch", err);
  }
}

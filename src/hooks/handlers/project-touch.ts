/**
 * Stop handler: when cwd resolves to an active registered project, bump its
 * `updated` timestamp and optionally capture a handoff from the last assistant
 * message. Otherwise no-op (parent-dir browse mode, unregistered cwd,
 * paused/complete/archived projects all fall through cleanly).
 *
 * The plan calls for the JSONs to never go stale silently — this is the
 * mechanism. CLI invocation is for explicit edits; this handler is for the
 * "you were just working in this project" auto-bump.
 */

import { logDebug, logError } from "../lib/log";
import { readAllProjects, resolveProjectFromCwd, writeProject } from "../lib/projects";
import { extractHandoff } from "../lib/work-tracking";

const HANDOFF_CAP = 300;

export async function projectTouch(lastAssistantMessage?: string): Promise<void> {
  try {
    const projects = readAllProjects();
    if (projects.length === 0) return;

    const resolved = resolveProjectFromCwd(process.cwd(), projects);
    if (!resolved) return;
    if (resolved.status !== "active") return;

    resolved.updated = new Date().toISOString();

    if (lastAssistantMessage?.trim()) {
      const handoff = extractHandoff(lastAssistantMessage).slice(0, HANDOFF_CAP);
      if (handoff) resolved.handoff = handoff;
    }

    writeProject(resolved);
    logDebug("project-touch", `bumped ${resolved.name} (${resolved.path})`);
  } catch (err) {
    logError("project-touch", err);
  }
}

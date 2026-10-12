/**
 * Everything that still exists, read into the event log once. Every event's id
 * comes from its source's own id, so a second run appends nothing.
 */

import { loggedEventIds } from "../../../hooks/lib/events";
import { readAllProjects } from "../../../hooks/lib/projects";
import { eventLogEnabled } from "../../../hooks/lib/settings";
import { backfillGit } from "./git";

function projectRepos(): string[] {
  const paths = readAllProjects().flatMap((project) =>
    project.path ? [project.path] : []
  );
  return [...new Set(paths)];
}

export function backfillEvents(since?: string): Record<string, number> {
  if (!eventLogEnabled()) return {};
  const known = loggedEventIds();
  return { git: backfillGit(projectRepos(), known, since) };
}

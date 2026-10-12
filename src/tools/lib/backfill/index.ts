/**
 * Everything that still exists, read into the event log once. Every event's id
 * comes from its source's own id, so a second run appends nothing.
 */

import { loggedEventIds } from "../../../hooks/lib/events";
import { readAllProjects } from "../../../hooks/lib/projects";
import { eventLogEnabled } from "../../../hooks/lib/settings";
import { backfillGit } from "./git";
import { backfillLedger } from "./ledger";
import { backfillProjects } from "./projects";
import { backfillRatings } from "./ratings";
import { backfillSessions } from "./sessions";
import { backfillTurns } from "./turns";

function projectRepos(): string[] {
  const paths = readAllProjects().flatMap((project) =>
    project.path ? [project.path] : []
  );
  return [...new Set(paths)];
}

export function backfillEvents(since?: string): Record<string, number> {
  if (!eventLogEnabled()) return {};
  const known = loggedEventIds();
  return {
    git: backfillGit(projectRepos(), known, since),
    sessions: backfillSessions(since),
    turns: backfillTurns(known, since),
    ratings: backfillRatings(known, since),
    ledger: backfillLedger(known, since),
    projects: backfillProjects(known, since),
  };
}

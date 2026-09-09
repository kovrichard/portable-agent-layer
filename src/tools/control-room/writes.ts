/**
 * The three things the page may change without an agent.
 *
 * Each one is a single named field on a single record, reached through the same
 * rule the CLI uses — the page is a second hand on the same instrument, not a
 * write surface over ~/.pal.
 */

import { readProject, writeProject } from "../../hooks/lib/projects";
import {
  raw as rawSettings,
  reload,
  write as writeSettings,
} from "../../hooks/lib/settings";
import { completeIsc, type IscSections, reopenIsc } from "../lib/project-isc";

export type WriteOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; status: number; error: string };

const missing = (project: string): WriteOutcome => ({
  ok: false,
  status: 404,
  error: `no such project: ${project}`,
});

export function setIscStatus(project: string, id: number, close: boolean): WriteOutcome {
  const p = readProject(project);
  if (!p) return missing(project);
  const sections: IscSections = {
    criteria: p.criteria ?? "",
    changelog: p.changelog ?? "",
  };
  const move = close ? completeIsc(sections, id) : reopenIsc(sections, id);
  if (!move.ok) return { ok: false, status: 404, error: move.reason };
  if (move.already) return { ok: true, changed: false };
  p.criteria = move.criteria;
  p.changelog = move.changelog;
  p.updated = new Date().toISOString();
  writeProject(p);
  return { ok: true, changed: true };
}

export const QUADRANTS = ["now", "plan", "noise", "later"] as const;
export type Quadrant = (typeof QUADRANTS)[number];

export function isQuadrant(value: unknown): value is Quadrant {
  return typeof value === "string" && (QUADRANTS as readonly string[]).includes(value);
}

/**
 * Importance already has a home in `serves`; urgency is read off the files.
 * A placement overrules the pair, and says who decided, so the next guess can
 * run freely without overwriting the answer.
 */
export function setPlacement(project: string, quadrant: Quadrant | null): WriteOutcome {
  const p = readProject(project);
  if (!p) return missing(project);
  if (quadrant) {
    p.placed = quadrant;
    p.placed_by = "user";
  } else {
    p.placed = undefined;
    p.placed_by = undefined;
  }
  p.updated = new Date().toISOString();
  writeProject(p);
  return { ok: true, changed: true };
}

export interface InstallSettings {
  actor: string;
  timezone: string;
}

export function readInstallSettings(): InstallSettings {
  const identity = rawSettings().identity ?? {};
  return {
    actor: identity.principal?.name ?? "",
    timezone: identity.principal?.timezone ?? "",
  };
}

/** Only the two fields the Settings panel offers; everything else is left alone. */
export function writeInstallSettings(update: Partial<InstallSettings>): WriteOutcome {
  if (update.timezone && !isTimezone(update.timezone)) {
    return { ok: false, status: 400, error: `not a timezone: ${update.timezone}` };
  }
  const data = rawSettings();
  const identity = data.identity ?? {};
  const principal = { ...identity.principal };
  if (update.actor !== undefined) principal.name = update.actor;
  if (update.timezone !== undefined) principal.timezone = update.timezone;
  writeSettings({ ...data, identity: { ...identity, principal } });
  reload();
  return { ok: true, changed: true };
}

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Which projects serve which stated goal, and how far along that makes it.
 *
 * The linkage needs judgement — "Catalyst is the starter that pays for the rest"
 * serves "land two retained clients" only if you know what both mean — so a model
 * draws it. The progress does not: it is criteria closed over criteria written,
 * counted here, because a model returning "64%" says something unfalsifiable
 * about a goal it cannot measure.
 */

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { paths } from "./paths";

interface GoalLink {
  goalId: string;
  projects: string[];
}

export interface GoalLinks {
  generatedAt: string;
  /** Hash of the goals and projects the linkage was drawn from. */
  inputs: string;
  links: GoalLink[];
}

export interface GoalProgress {
  projects: string[];
  closed: number;
  written: number;
}

function goalLinksPath(): string {
  return resolve(paths.state(), "goal-links.json");
}

export function readGoalLinks(): GoalLinks | null {
  const path = goalLinksPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as GoalLinks;
    return Array.isArray(parsed.links) && parsed.generatedAt ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeGoalLinks(links: GoalLinks): Promise<void> {
  await writeFile(goalLinksPath(), `${JSON.stringify(links, null, 2)}\n`, "utf-8");
}

/**
 * A stable fingerprint of what the linkage was drawn from, so a stop where
 * neither the goals nor the projects moved costs nothing.
 */
export function linkInputs(goalIds: string[], projectSlugs: string[]): string {
  return Bun.hash(
    JSON.stringify([[...goalIds].sort(), [...projectSlugs].sort()])
  ).toString(36);
}

/**
 * Counted, not estimated. A goal nothing serves has no progress rather than
 * zero — "no project serves this yet" is the answer worth showing.
 */
export function progressFor(
  goalId: string,
  links: GoalLinks | null,
  criteriaBySlug: Map<string, { closed: number; written: number }>
): GoalProgress | null {
  const projects = links?.links.find((l) => l.goalId === goalId)?.projects ?? [];
  const known = projects.filter((slug) => criteriaBySlug.has(slug));
  if (known.length === 0) return null;
  let closed = 0;
  let written = 0;
  for (const slug of known) {
    const counts = criteriaBySlug.get(slug) as { closed: number; written: number };
    closed += counts.closed;
    written += counts.written;
  }
  return { projects: known, closed, written };
}

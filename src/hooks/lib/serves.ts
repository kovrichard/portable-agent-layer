/**
 * What a project is for, and what that makes it worth.
 *
 * Importance cannot be read off a repository: two projects with identical
 * activity can be a client's livelihood and a weekend toy. So the record carries
 * one fact PAL guesses and the user can overrule — never a name or a rank
 * written into source, because next month the same code serves something else.
 */

import {
  readProject,
  type ServesAuthority,
  type ServesKind,
  writeProject,
} from "./projects";

export const SERVES_KINDS: ServesKind[] = ["goal", "revenue", "fun"];

export const SERVES_MEANING: Record<ServesKind, string> = {
  goal: "serves a stated goal",
  revenue: "a way this could pay",
  fun: "kept for its own sake",
};

/** A goal and a revenue bet are worth protecting time for; fun is not. */
export function isImportant(kind: ServesKind | undefined): boolean {
  return kind === "goal" || kind === "revenue";
}

export function isServesKind(value: unknown): value is ServesKind {
  return typeof value === "string" && SERVES_KINDS.includes(value as ServesKind);
}

export interface ServesUpdate {
  name: string;
  kind: ServesKind;
  note?: string;
  by: ServesAuthority;
}

/**
 * A guess never overwrites an answer. This is the whole reason the record
 * stores who decided: re-inference runs freely and the user is only asked once.
 *
 * Writing does bump `updated`, like every other write to the record — a hobby
 * project that becomes the thing people depend on should rank as touched the
 * moment that is written down, not fourteen days later.
 */
export function setServes(update: ServesUpdate): "written" | "kept" | "missing" {
  const project = readProject(update.name);
  if (!project) return "missing";
  if (update.by === "inferred" && project.serves_by === "user") return "kept";

  project.serves = update.kind;
  project.serves_by = update.by;
  if (update.note) project.serves_note = update.note;
  project.updated = new Date().toISOString();
  writeProject(project);
  return "written";
}

/**
 * Projects — registry of user-curated projects with auto-managed state.
 *
 * Each project lives in `~/.pal/memory/state/progress/{slug}.json`. The CLI
 * (`src/tools/agent/project.ts`) is the user/AI-facing writer; the Stop hook
 * auto-touches `updated` when cwd resolves into a registered project.
 *
 * Replaces the hand-edited `~/.pal/telos/PROJECTS.md` — see plan
 * `~/.claude/plans/clever-frolicking-harp.md` for context.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve, sep } from "node:path";
import { paths } from "./paths";

export type ProjectStatus = "active" | "paused" | "complete" | "archived";

export interface Decision {
  ts: string;
  decision: string;
  rationale: string;
}

export interface ProjectProgress {
  name: string;
  path: string;
  status: ProjectStatus;
  created: string;
  updated: string;
  objectives?: string[];
  next_steps?: string[];
  blockers?: string[];
  handoff?: string;
  decisions?: Decision[];
}

export const PROJECT_STALE_DAYS_DEFAULT = 14;

const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "deno.json",
  "Gemfile",
];

function progressDir(): string {
  const dir = paths.progress();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function progressFile(slug: string): string {
  return resolve(progressDir(), `${slug}.json`);
}

/**
 * Compute the default project slug from a cwd.
 *
 * Returns the FULL last path segment, lowercased, with non-[a-z0-9_-] chars
 * collapsed to a single hyphen. Critically: never split on `-` or any
 * separator within the basename. `/repos/portable-agent-layer` →
 * `portable-agent-layer`, NOT `layer`.
 */
export function defaultSlug(cwd: string): string {
  const base = basename(resolve(cwd));
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "unnamed";
}

/**
 * Heuristic: does this directory look like a project root (has a project marker)?
 * Used by the SessionStart loader to hint the AI when an unregistered cwd is
 * project-shaped, so registration can be suggested in conversation.
 */
export function looksLikeProjectRoot(cwd: string): boolean {
  const cwdAbs = resolve(cwd);
  return PROJECT_MARKERS.some((marker) => existsSync(resolve(cwdAbs, marker)));
}

export function readAllProjects(): ProjectProgress[] {
  const dir = progressDir();
  if (!existsSync(dir)) return [];
  const out: ProjectProgress[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const parsed = JSON.parse(
        readFileSync(resolve(dir, file), "utf-8")
      ) as ProjectProgress;
      if (parsed?.name && parsed?.path && parsed?.status) out.push(parsed);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export function readProject(name: string): ProjectProgress | null {
  const file = progressFile(name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as ProjectProgress;
  } catch {
    return null;
  }
}

export function writeProject(p: ProjectProgress): void {
  writeFileSync(progressFile(p.name), `${JSON.stringify(p, null, 2)}\n`, "utf-8");
}

export function deleteProject(name: string): boolean {
  const file = progressFile(name);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

/**
 * Resolve `cwd` to the registered project that contains it, if any.
 *
 * Rules:
 *  - Exact-match registered path → that project.
 *  - Descendant of exactly one registered path → that project.
 *  - Descendant of multiple (nested) → longest registered path wins.
 *  - Ancestor of registered project (parent-dir browse mode) → null.
 *  - Unrelated cwd → null.
 *
 * The parent-dir case is the load-bearing one: opening `/repos/` (an ancestor
 * of multiple registered repos) MUST return null so the Stop-hook auto-write
 * doesn't ambiguously bump one of N children.
 */
export function resolveProjectFromCwd(
  cwd: string,
  projects: ProjectProgress[]
): ProjectProgress | null {
  const cwdAbs = resolve(cwd);
  const matches = projects.filter((p) => {
    const projAbs = resolve(p.path);
    return cwdAbs === projAbs || cwdAbs.startsWith(projAbs + sep);
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.path.length - a.path.length);
  return matches[0];
}

export function isStale(
  p: ProjectProgress,
  thresholdDays = PROJECT_STALE_DAYS_DEFAULT
): boolean {
  if (!p.updated) return false;
  const age = Date.now() - new Date(p.updated).getTime();
  if (!Number.isFinite(age) || age < 0) return false;
  return age > thresholdDays * 86_400_000;
}

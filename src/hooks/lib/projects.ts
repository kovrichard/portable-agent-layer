/**
 * Projects — registry of user-curated projects backed by ISA.md files.
 *
 * Each project lives in `~/.pal/memory/projects/{slug}/ISA.md`. Frontmatter
 * holds operational state; the body holds ISA spec sections. The CLI
 * (`src/tools/agent/project.ts`) is the primary writer; the Stop hook
 * auto-touches `updated` when cwd resolves into a registered project.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, parse as parsePath, resolve, sep } from "node:path";
import { parse, stringify } from "./frontmatter";
import { paths } from "./paths";

export type ProjectStatus = "active" | "paused" | "complete" | "archived";

export interface ProjectProgress {
  name: string;
  path: string;
  status: ProjectStatus;
  created: string;
  updated: string;
  next?: string[];
  blockers?: string[];
  handoff?: string;
  // ISA body sections
  problem?: string;
  goal?: string;
  criteria?: string;
  vision?: string;
  constraints?: string;
  out_of_scope?: string;
  context?: string;
  decisions?: string;
  changelog?: string;
}

const PROJECT_STALE_DAYS_DEFAULT = 14;

const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "deno.json",
  "Gemfile",
];

type IsaMeta = {
  name: string;
  path: string;
  status: ProjectStatus;
  created: string;
  updated: string;
  next?: string[];
  blockers?: string[];
  handoff?: string;
};

const BODY_SECTIONS: Array<[string, keyof ProjectProgress]> = [
  ["Problem", "problem"],
  ["Goal", "goal"],
  ["Criteria", "criteria"],
  ["Vision", "vision"],
  ["Constraints", "constraints"],
  ["Out of Scope", "out_of_scope"],
  ["Context", "context"],
  ["Decisions", "decisions"],
  ["Changelog", "changelog"],
];

const HEADER_TO_FIELD: Record<string, keyof ProjectProgress> = Object.fromEntries(
  BODY_SECTIONS.map(([h, k]) => [h.toLowerCase(), k])
);

function buildBody(p: ProjectProgress): string {
  return BODY_SECTIONS.filter(([, k]) => (p[k] as string | undefined)?.trim())
    .map(([h, k]) => `## ${h}\n\n${(p[k] as string).trim()}`)
    .join("\n\n");
}

function extractSections(body: string): Partial<ProjectProgress> {
  const out: Partial<ProjectProgress> = {};
  for (const part of body.split(/^## /m).slice(1)) {
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const header = part.slice(0, nl).trim().toLowerCase();
    const content = part.slice(nl + 1).trim();
    if (!content) continue;
    const field = HEADER_TO_FIELD[header];
    if (field) (out as Record<string, string>)[field as string] = content;
  }
  return out;
}

function isaFilePath(slug: string): string {
  return resolve(paths.projectHistory(), slug, "ISA.md");
}

function ensureAndGetIsaFile(slug: string): string {
  const dir = resolve(paths.projectHistory(), slug);
  mkdirSync(dir, { recursive: true });
  return resolve(dir, "ISA.md");
}

/**
 * Compute the default project slug from a cwd.
 *
 * Returns the FULL last path segment, lowercased, with non-[a-z0-9_-] chars
 * collapsed to a single hyphen. Never splits on `-`. `/repos/portable-agent-layer`
 * → `portable-agent-layer`, NOT `layer`.
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
 */
export function looksLikeProjectRoot(cwd: string): boolean {
  const cwdAbs = resolve(cwd);
  return PROJECT_MARKERS.some((marker) => existsSync(resolve(cwdAbs, marker)));
}

export function readAllProjects(): ProjectProgress[] {
  const base = paths.projectHistory();
  if (!existsSync(base)) return [];
  const out: ProjectProgress[] = [];
  for (const slug of readdirSync(base)) {
    const file = resolve(base, slug, "ISA.md");
    if (!existsSync(file)) continue;
    const p = readProject(slug);
    if (p) out.push(p);
  }
  return out;
}

export function readProject(name: string): ProjectProgress | null {
  const file = isaFilePath(name);
  if (!existsSync(file)) return null;
  try {
    const content = readFileSync(file, "utf-8");
    const { meta, body } = parse<IsaMeta>(content);
    if (!meta?.name || !meta?.path || !meta?.status) return null;
    return { ...meta, ...extractSections(body) };
  } catch {
    return null;
  }
}

export function writeProject(p: ProjectProgress): void {
  const meta: Record<string, unknown> = {
    name: p.name,
    path: p.path,
    status: p.status,
    created: p.created,
    updated: p.updated,
  };
  if (p.next?.length) meta.next = p.next;
  if (p.blockers?.length) meta.blockers = p.blockers;
  if (p.handoff) meta.handoff = p.handoff;
  writeFileSync(ensureAndGetIsaFile(p.name), stringify(meta, buildBody(p)), "utf-8");
}

export function deleteProject(name: string): boolean {
  const file = isaFilePath(name);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  try {
    rmdirSync(resolve(paths.projectHistory(), name));
  } catch {
    /* dir not empty or already gone */
  }
  return true;
}

/**
 * Resolve `cwd` to the registered project that contains it, if any.
 *
 * Parent-dir browse mode (cwd is an ancestor of a registered project) → null.
 * Multiple nested projects → longest registered path wins.
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

/**
 * Walk up from `cwd` looking for the nearest dir with a project marker.
 * Returns absolute path or null. Bounded at 12 levels to avoid runaway walks.
 */
function findProjectRoot(cwd: string): string | null {
  let dir = resolve(cwd);
  const fsRoot = parsePath(dir).root;
  for (let i = 0; i < 12; i++) {
    if (looksLikeProjectRoot(dir)) return dir;
    if (dir === fsRoot) return null;
    dir = dirname(dir);
  }
  return null;
}

function formatAgo(ts: string): string {
  if (!ts) return "?";
  const age = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(age)) return "?";
  if (age < 60_000) return "just now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return "today";
  const days = Math.floor(age / 86_400_000);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const MAX_INLINE_BULLETS = 3;

/**
 * Format the SessionStart "Active Projects" section.
 *
 * For the cwd-resolved project (`→ here`): full detail with Context, Objectives
 * (from goal section), Next, and Blockers. For all others: compact one-liner with
 * next/blocker counts only. Stale flag (>14d) and browse-mode hint included.
 */
export function loadActiveProjectsContext(cwd: string = process.cwd()): string {
  const all = readAllProjects();
  const visible = all.filter((p) => p.status === "active" || p.status === "paused");
  const resolved = resolveProjectFromCwd(cwd, visible);
  const projectRoot = findProjectRoot(cwd);
  const alreadyRegistered =
    projectRoot !== null && all.some((p) => resolve(p.path) === projectRoot);
  const showHint = resolved === null && projectRoot !== null && !alreadyRegistered;

  if (visible.length === 0 && !showHint) return "";

  const lines: string[] = [];

  if (visible.length > 0) {
    lines.push("## Active Projects");
    lines.push("");
    const sorted = [...visible].sort((a, b) => b.updated.localeCompare(a.updated));
    for (const p of sorted) {
      const ago = formatAgo(p.updated);
      const stale = isStale(p) ? " ⚠ stale" : "";
      const isResolved = resolved !== null && p.name === resolved.name;
      const here = isResolved ? " → here" : "";
      const statusPrefix = p.status === "paused" ? "paused, " : "";

      if (isResolved) {
        lines.push(`- **${p.name}** (${statusPrefix}${ago})${stale}${here}`);
        if (p.context) {
          const bullets = p.context
            .split("\n")
            .map((l) => l.replace(/^[-*]\s*/, "").trim())
            .filter(Boolean);
          lines.push(`  Facts: ${bullets.slice(0, MAX_INLINE_BULLETS).join("; ")}`);
        }
        if (p.goal) {
          const bullets = p.goal
            .split("\n")
            .map((l) => l.replace(/^[-*]\s*/, "").trim())
            .filter(Boolean);
          lines.push(`  Objectives: ${bullets.slice(0, MAX_INLINE_BULLETS).join("; ")}`);
        }
        if (p.constraints) {
          const bullets = p.constraints
            .split("\n")
            .map((l) => l.replace(/^[-*]\s*/, "").trim())
            .filter(Boolean);
          lines.push(`  Constraints: ${bullets.slice(0, MAX_INLINE_BULLETS).join("; ")}`);
        }
        if (p.next?.length) {
          lines.push(`  Next: ${p.next.slice(0, MAX_INLINE_BULLETS).join("; ")}`);
        }
        if (p.blockers?.length) {
          lines.push(`  Blockers: ${p.blockers.slice(0, MAX_INLINE_BULLETS).join("; ")}`);
        }
        if (p.criteria) {
          const openIscs = p.criteria
            .split("\n")
            .filter((l) => /^-\s+\[ \]\s+ISC-\d+:/i.test(l))
            .map((l) => l.replace(/^-\s+\[ \]\s+/, "").trim());
          if (openIscs.length > 0) {
            lines.push(
              `  Open ISCs (${openIscs.length}): ${openIscs.slice(0, MAX_INLINE_BULLETS).join("; ")}`
            );
          }
        }
      } else {
        const counts: string[] = [];
        if (p.next?.length) counts.push(`${p.next.length} next`);
        if (p.blockers?.length) counts.push(`${p.blockers.length} blockers`);
        const countsSuffix = counts.length > 0 ? ` — ${counts.join(", ")}` : "";
        lines.push(`- **${p.name}** (${statusPrefix}${ago})${countsSuffix}${stale}`);
      }
    }
  }

  if (showHint) {
    if (visible.length > 0) lines.push("");
    lines.push(
      `💡 \`${projectRoot}\` looks like a project but isn't registered. If substantive work starts here, suggest registering it via \`bun ~/.pal/tools/project.ts create\`.`
    );
  }

  return lines.join("\n");
}

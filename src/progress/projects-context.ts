import { dirname, parse as parsePath, resolve } from "node:path";
import {
  isStale,
  looksLikeProjectRoot,
  PROJECT_STALE_DAYS_DEFAULT,
  type ProjectProgress,
  readAllProjects,
  resolveProjectFromCwd,
} from "./projects";

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
const FACTS_BUDGET = 600;

function factLines(context: string): string[] {
  return context
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** Whole facts in written order, so none is cut mid-sentence; the first always fits. */
function factsLine(project: string, context: string): string {
  const facts = factLines(context);
  const shown = facts.slice(0, 1);

  for (const fact of facts.slice(1)) {
    if ([...shown, fact].join("; ").length > FACTS_BUDGET) break;
    shown.push(fact);
  }

  const more =
    shown.length < facts.length ? ` (more: \`pal cli project resume ${project}\`)` : "";

  return `  Facts: ${shown.join("; ")}${more}`;
}

function bulletItems(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function inlineList(label: string, items: string[] | undefined): string[] {
  if (!items?.length) return [];

  return [inlineListAlways(label, items)];
}

function statusAndAgo(p: ProjectProgress): string {
  const statusPrefix = p.status === "paused" ? "paused, " : "";

  return `${statusPrefix}${formatAgo(p.updated)}`;
}

function resolvedProjectLines(p: ProjectProgress): string[] {
  const stale = isStale(p) ? " ⚠ stale" : "";

  return [
    `- **${p.name}** (${statusAndAgo(p)})${stale} → here`,
    ...(p.context ? [factsLine(p.name, p.context)] : []),
    ...(p.goal ? [inlineListAlways("Objectives", bulletItems(p.goal))] : []),
    ...(p.constraints
      ? [inlineListAlways("Constraints", bulletItems(p.constraints))]
      : []),
    ...inlineList("Next", p.next),
    ...inlineList("Blockers", p.blockers),
  ];
}

function inlineListAlways(label: string, items: string[]): string {
  return `  ${label}: ${items.slice(0, MAX_INLINE_BULLETS).join("; ")}`;
}

function otherProjectLine(p: ProjectProgress, last: string | undefined): string {
  const counts: string[] = [];

  if (p.next?.length) counts.push(`${p.next.length} next`);

  if (p.blockers?.length) counts.push(`${p.blockers.length} blockers`);
  const countsSuffix = counts.length > 0 ? ` — ${counts.join(", ")}` : "";
  const lastSuffix = last ? ` — last: ${last}` : "";

  return `- **${p.name}** (${statusAndAgo(p)})${countsSuffix}${lastSuffix}`;
}

/**
 * Format the SessionStart "Active Projects" section.
 *
 * For the cwd-resolved project (`→ here`): full detail with Context, Objectives
 * (from goal section), Next, and Blockers. Other recent projects: one line with
 * counts and the last session's title, enough to follow up from any folder.
 * Quiet ones (>14d) collapse to a single line of names.
 */
function activeProjectLines(
  visible: ProjectProgress[],
  resolvedName: string | undefined,
  lastSessionTitle: (project: string) => string | undefined
): string[] {
  const lines = ["## Active Projects", ""];
  const sorted = [...visible].sort((a, b) => b.updated.localeCompare(a.updated));
  const quiet: string[] = [];

  for (const p of sorted) {
    if (resolvedName !== undefined && p.name === resolvedName) {
      lines.push(...resolvedProjectLines(p));
    } else if (isStale(p)) {
      quiet.push(p.name);
    } else {
      lines.push(otherProjectLine(p, lastSessionTitle(p.name)));
    }
  }

  if (quiet.length > 0) {
    lines.push(`- Quiet for ${PROJECT_STALE_DAYS_DEFAULT}+ days: ${quiet.join(", ")}`);
  }

  return lines;
}

export function loadActiveProjectsContext(
  cwd: string = process.cwd(),
  lastSessionTitle: (project: string) => string | undefined = () => undefined
): string {
  const all = readAllProjects();
  const visible = all.filter((p) => p.status === "active" || p.status === "paused");
  const resolved = resolveProjectFromCwd(cwd, visible);
  const projectRoot = findProjectRoot(cwd);
  const alreadyRegistered =
    projectRoot !== null &&
    all.some((p) => p.path !== undefined && resolve(p.path) === projectRoot);
  const showHint = resolved === null && projectRoot !== null && !alreadyRegistered;

  if (visible.length === 0 && !showHint) return "";

  const lines: string[] = [];

  if (visible.length > 0) {
    lines.push(...activeProjectLines(visible, resolved?.name, lastSessionTitle));
  }

  if (showHint) {
    if (visible.length > 0) lines.push("");
    lines.push(
      `💡 \`${projectRoot}\` looks like a project but isn't registered. If substantive work starts here, suggest registering it via \`pal cli project create\`.`
    );
  }

  return lines.join("\n");
}

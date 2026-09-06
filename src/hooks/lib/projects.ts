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
import { type Bindings, readBindings, writeBinding, writeBindings } from "./bindings";
import { parse, stringify } from "./frontmatter";
import { palHome, paths } from "./paths";
import { detectRemote } from "./remote";

export type ProjectStatus = "active" | "paused" | "complete" | "archived";

/** What a project is for. The three answers importance can be ranked from. */
export type ServesKind = "goal" | "revenue" | "fun";
/** Who decided it. A user answer outranks a guess and survives re-inference. */
export type ServesAuthority = "inferred" | "user";

export interface ProjectProgress {
  name: string;
  /** Resolved for this machine at read time; absent when not checked out here. */
  path?: string;
  /** Normalized git origin — the same on every machine, so this one does travel. */
  remote?: string;
  status: ProjectStatus;
  created: string;
  updated: string;
  next?: string[];
  blockers?: string[];
  handoff?: string;
  /** What this project is for — the fact importance is ranked from. */
  serves?: ServesKind;
  serves_note?: string;
  serves_by?: ServesAuthority;
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

// ── Legacy migration types ────────────────────────────────────────
// Shared by `pal cli migrate` and `pal tool agent project --migrate` —
// both convert the old progress-JSON format to current ProjectProgress.

interface LegacyDecision {
  ts: string;
  decision: string;
  rationale: string;
}

interface LegacyProject {
  name: string;
  path: string;
  status: ProjectStatus;
  created: string;
  updated: string;
  facts?: string[];
  objectives?: string[];
  next_steps?: string[];
  blockers?: string[];
  handoff?: string;
  decisions?: LegacyDecision[];
}

/**
 * Convert a parsed legacy progress JSON object into the current ProjectProgress
 * shape. Returns null if required fields (name/path/status) are missing.
 */
export function legacyJsonToProgress(raw: unknown): ProjectProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as LegacyProject;
  if (!r.name || !r.path || !r.status) return null;
  const p: ProjectProgress = {
    name: r.name,
    path: r.path,
    status: r.status,
    created: r.created ?? new Date().toISOString(),
    updated: r.updated ?? new Date().toISOString(),
    ...(r.handoff ? { handoff: r.handoff } : {}),
    ...(r.next_steps?.length ? { next: r.next_steps } : {}),
    ...(r.blockers?.length ? { blockers: r.blockers } : {}),
  };
  if (r.facts?.length) p.context = r.facts.join("\n");
  if (r.objectives?.length) p.goal = r.objectives.map((o) => `- ${o}`).join("\n");
  if (r.decisions?.length) {
    p.decisions = r.decisions
      .map((d) => `- ${d.ts.slice(0, 10)}: ${d.decision} (${d.rationale})`)
      .join("\n");
  }
  return p;
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

type IsaMeta = {
  name: string;
  /** Legacy only — records written since bindings landed carry no path. */
  path?: string;
  remote?: string;
  status: ProjectStatus;
  created: string;
  updated: string;
  next?: string[];
  blockers?: string[];
  handoff?: string;
  serves?: ServesKind;
  serves_note?: string;
  serves_by?: ServesAuthority;
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

/**
 * Every project record, with `path` resolved to this machine.
 *
 * Seeds bindings for any project not yet bound here, which is what makes the
 * binding file self-maintaining: no install step, no migration, no command to
 * remember. Seeding is idempotent and writes only when it actually binds
 * something, so the steady-state cost is the one `bindings.json` read below.
 */
export function readAllProjects(): ProjectProgress[] {
  const base = paths.projectHistory();
  if (!existsSync(base)) return [];
  const bindings = readBindings();
  const out: ProjectProgress[] = [];
  for (const slug of readdirSync(base)) {
    const file = resolve(base, slug, "ISA.md");
    if (!existsSync(file)) continue;
    const p = readProject(slug, bindings);
    if (p) out.push(p);
  }
  seedBindings(out);
  return out;
}

export function readProject(
  name: string,
  bindings: Bindings = readBindings()
): ProjectProgress | null {
  const file = isaFilePath(name);
  if (!existsSync(file)) return null;
  try {
    const content = readFileSync(file, "utf-8");
    const { meta, body } = parse<IsaMeta>(content);
    if (!meta?.name || !meta?.status) return null;
    // `path` is machine-local: the binding is the real source, and meta.path is
    // only still read so records written before this change keep resolving.
    const bound = bindings[meta.name] ?? meta.path;
    const path = bound ? resolve(bound) : undefined;
    return { ...meta, path, ...extractSections(body) };
  } catch {
    return null;
  }
}

/**
 * Persist a project. The `path` is deliberately NOT written into the record:
 * records travel in an export, and one machine's disk layout is meaningless — or
 * actively wrong — on another. It is recorded as a binding instead, which stays
 * on this machine. Callers keep setting `p.path` as before; only where it lands
 * has changed.
 */
export function writeProject(p: ProjectProgress): void {
  // Detected once and then kept: the remote is stable, and re-running git on
  // every save would spawn a subprocess per project write for no new information.
  if (!p.remote && p.path && existsSync(p.path)) {
    const detected = detectRemote(p.path);
    if (detected) p.remote = detected;
  }
  // Only a path that exists here may be bound. Saving a record is not a claim
  // about this machine's disk — `path` may have arrived from an imported record
  // written elsewhere, and binding it would recreate the very leak bindings exist
  // to prevent. An explicit `writeBinding` from the user stays unguarded.
  if (p.path && existsSync(p.path)) writeBinding(p.name, p.path);
  const meta: Record<string, unknown> = {
    name: p.name,
    status: p.status,
    created: p.created,
    updated: p.updated,
  };
  // Unlike `path`, this one is written into the record on purpose — it identifies
  // the repository rather than one machine's copy of it.
  if (p.remote) meta.remote = p.remote;
  if (p.next?.length) meta.next = p.next;
  if (p.blockers?.length) meta.blockers = p.blockers;
  if (p.handoff) meta.handoff = p.handoff;
  if (p.serves) meta.serves = p.serves;
  if (p.serves_note) meta.serves_note = p.serves_note;
  if (p.serves_by) meta.serves_by = p.serves_by;
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
/**
 * Where a project sits on THIS machine.
 *
 * A record's `path` is written by whichever machine last touched it and travels
 * with the corpus, so on any other machine it is a claim rather than a fact. A
 * binding is local by construction, so it wins; the record's path remains the
 * fallback until this machine has bound the project.
 *
 * Note the fallback still trusts a foreign path — closing that is ISC-48 task 4
 * proper, which requires seeding to be wired first.
 */
export function projectPathOnThisMachine(
  project: ProjectProgress,
  bindings: Bindings = readBindings()
): string | null {
  const bound = bindings[project.name] ?? project.path;
  return bound ? resolve(bound) : null;
}

export function resolveProjectFromCwd(
  cwd: string,
  projects: ProjectProgress[],
  bindings: Bindings = readBindings()
): ProjectProgress | null {
  const cwdAbs = resolve(cwd);
  const matches: { project: ProjectProgress; path: string }[] = [];
  for (const project of projects) {
    const projAbs = projectPathOnThisMachine(project, bindings);
    if (!projAbs) continue;
    if (cwdAbs === projAbs || cwdAbs.startsWith(projAbs + sep))
      matches.push({ project, path: projAbs });
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.path.length - a.path.length);
  return matches[0].project;
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
    projectRoot !== null &&
    all.some((p) => p.path !== undefined && resolve(p.path) === projectRoot);
  const showHint = resolved === null && projectRoot !== null && !alreadyRegistered;

  if (visible.length === 0 && !showHint) return "";

  const lines: string[] = [];

  if (visible.length > 0) {
    lines.push("## Active Projects", "");
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

/**
 * Adopt the `path` already stored on each project record, for projects not yet
 * bound here.
 *
 * Two guards keep this from importing another machine's filesystem. An existing
 * binding always wins, because a binding is what THIS machine knows while a
 * record's path may belong to any machine that ever wrote it. And a path is
 * adopted only if it exists locally — that is what makes seeding safe to run on
 * a machine that just imported someone else's corpus: their paths are simply not
 * here, so nothing binds and those projects stay correctly unbound.
 *
 * Seeding is inference, so it is conservative. `writeBinding` is a statement by
 * the user and is trusted without an existence check — binding a path you are
 * about to clone into has to work.
 *
 * Returns the names newly bound, so a caller can stay silent on the common no-op.
 */
export function seedBindings(
  projects: ProjectProgress[],
  home: string = palHome()
): string[] {
  const bindings = readBindings(home);
  const seeded: string[] = [];
  for (const project of projects) {
    if (!project.name || !project.path) continue;
    if (project.name in bindings) continue;
    if (!existsSync(project.path)) continue;
    bindings[project.name] = resolve(project.path);
    seeded.push(project.name);
  }
  if (seeded.length === 0) return [];
  writeBindings(bindings, home);
  return seeded;
}

export type BindingIssue =
  | { kind: "unlocatable"; project: string }
  | { kind: "missing"; project: string; path: string }
  | { kind: "shared"; path: string; projects: string[] };

/**
 * Health of this machine's project bindings.
 *
 * Three things can go wrong once a path is machine-local. A project can become
 * unlocatable, which is what losing bindings.json looks like from the outside.
 * A binding can outlive the directory it names. And two projects can end up on
 * one directory — the shape that appears when a name is reused for a second
 * checkout, where binding by name alone would silently repoint the first.
 *
 * Read-only by construction: it reports, it never repairs.
 */
export function auditBindings(
  projects: ProjectProgress[] = readAllProjects(),
  bindings: Bindings = readBindings()
): BindingIssue[] {
  const issues: BindingIssue[] = [];
  const byPath = new Map<string, string[]>();

  for (const project of projects) {
    const path = projectPathOnThisMachine(project, bindings);
    if (!path) {
      issues.push({ kind: "unlocatable", project: project.name });
      continue;
    }
    if (!existsSync(path)) {
      issues.push({ kind: "missing", project: project.name, path });
      continue;
    }
    byPath.set(path, [...(byPath.get(path) ?? []), project.name]);
  }

  for (const [path, names] of byPath) {
    if (names.length > 1) issues.push({ kind: "shared", path, projects: names.sort() });
  }

  return issues;
}

/**
 * Every issue names the command that fixes it. PAL runs inside agents, where a
 * hook cannot ask a question — so a suggestion is always a command the user can
 * choose to run, never something applied on their behalf.
 */
export function describeBindingIssue(issue: BindingIssue): string {
  const fix = (name: string) => `run 'project set-path ${name} <path>'`;
  if (issue.kind === "unlocatable")
    return `${issue.project} — not checked out here (${fix(issue.project)})`;
  // "points at" rather than "bound to": the path may equally have come from a
  // legacy record's own field, which is not a binding.
  if (issue.kind === "missing")
    return `${issue.project} — points at ${issue.path}, which does not exist here (${fix(issue.project)})`;
  return `${issue.projects.join(" and ")} — both point at ${issue.path}; rebind whichever is wrong (${fix(issue.projects[0])})`;
}

export type BindingProposal = {
  state: "unbound";
  confidence: "strong" | "weak";
  reason: string;
  candidate: string;
  command: string;
};

/**
 * What PAL would suggest for a project it cannot locate, given where the user
 * currently is. A matching git remote is strong evidence — two checkouts of one
 * repository — while a matching directory name is only weak, because a name can
 * be reused for an unrelated copy. Returns null when there is nothing worth
 * saying, which is the common case.
 */
export function proposeBinding(
  project: ProjectProgress,
  cwd: string = process.cwd()
): BindingProposal | null {
  const command = `pal cli project set-path ${project.name} ${cwd}`;
  const cwdRemote = detectRemote(cwd);

  if (project.remote && cwdRemote === project.remote) {
    return {
      state: "unbound",
      confidence: "strong",
      reason: `the repository here is ${cwdRemote}, which is this project's recorded remote`,
      candidate: cwd,
      command,
    };
  }

  if (basename(cwd) === project.name) {
    return {
      state: "unbound",
      confidence: "weak",
      reason:
        "this directory shares the project's name, but nothing confirms it is the same one — a name can belong to more than one checkout",
      candidate: cwd,
      command,
    };
  }

  return null;
}

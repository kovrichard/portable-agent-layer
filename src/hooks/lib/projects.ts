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
import * as hostPath from "node:path";
import { basename, resolve } from "node:path";
import { type Bindings, readBindings, writeBinding, writeBindings } from "./bindings";
import { parse, stringify } from "./frontmatter";
import { palHome, paths } from "./paths";
import { detectRemote } from "./remote";

/** The path functions of one platform: the host's, or `path.win32` / `path.posix` in tests. */
export type PlatformPath = typeof hostPath.posix;

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
  /** What this project is for — the fact importance is ranked from. */
  serves?: ServesKind;
  serves_note?: string;
  serves_by?: ServesAuthority;
  /** The user's own placement on the grid, which overrules both guesses. */
  placed?: string;
  placed_by?: ServesAuthority;
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
    const { meta, body } = parse<IsaMeta & { handoff?: string }>(content);
    if (!meta?.name || !meta?.status) return null;
    // `path` is machine-local: the binding is the real source, and meta.path is
    // only still read so records written before this change keep resolving.
    const bound = bindings[meta.name] ?? meta.path;
    const path = bound ? resolve(bound) : undefined;
    const { handoff: _retired, ...kept } = meta;

    return { ...kept, path, ...extractSections(body) };
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

  if (p.serves) meta.serves = p.serves;

  if (p.serves_note) meta.serves_note = p.serves_note;

  if (p.serves_by) meta.serves_by = p.serves_by;

  if (p.placed) meta.placed = p.placed;

  if (p.placed_by) meta.placed_by = p.placed_by;
  writeFileSync(ensureAndGetIsaFile(p.name), stringify(meta, buildBody(p)), "utf-8");

  if (pathExistsOnThisMachine(p.path)) writeBinding(p.name, p.path);
}

function pathExistsOnThisMachine(path: string | undefined): path is string {
  return Boolean(path) && existsSync(path as string);
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
  bindings: Bindings = readBindings(),
  paths: PlatformPath = hostPath
): string | null {
  const bound = bindings[project.name] ?? project.path;

  return bound ? paths.resolve(bound) : null;
}

export function resolveProjectFromCwd(
  cwd: string,
  projects: ProjectProgress[],
  bindings: Bindings = readBindings(),
  paths: PlatformPath = hostPath
): ProjectProgress | null {
  // Windows paths are case-insensitive, so both sides are folded before comparing.
  const fold = (p: string) => (paths.sep === "\\" ? p.toLowerCase() : p);
  const cwdAbs = fold(paths.resolve(cwd));
  const matches: { project: ProjectProgress; path: string }[] = [];

  for (const project of projects) {
    const projAbs = projectPathOnThisMachine(project, bindings, paths);
    if (!projAbs) continue;
    const key = fold(projAbs);
    if (cwdAbs === key || cwdAbs.startsWith(key + paths.sep))
      matches.push({ project, path: key });
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => b.path.length - a.path.length);

  return matches[0].project;
}

export function isStale(
  p: ProjectProgress,
  thresholdDays = PROJECT_STALE_DAYS_DEFAULT,
  now: Date = new Date()
): boolean {
  if (!p.updated) return false;
  const age = now.getTime() - new Date(p.updated).getTime();
  if (!Number.isFinite(age) || age < 0) return false;

  return age > thresholdDays * 86_400_000;
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

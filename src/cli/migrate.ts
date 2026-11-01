/**
 * pal cli migrate — the only place PAL knows about its own past.
 *
 * Each Migration has:
 *   check() — reads what is on disk, so it is safe to call on every install
 *   run()   — applies it; user data is moved, never deleted, while leftovers
 *             PAL itself wrote and no longer reads are removed
 *
 * Retiring a setting, hook, file or name means adding a migration that removes
 * its leftovers. Install runs pending migrations first; the doctor lists them.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { resolveAnchor } from "../hooks/lib/anchor";
import { readBindings } from "../hooks/lib/bindings";
import { mergeJsonlLines } from "../hooks/lib/import-merge";
import { foldHistoryInto } from "../hooks/lib/parked-history";
import { palHome, paths } from "../hooks/lib/paths";
import { appendEvent, scopeOf } from "../hooks/lib/progress-tree";
import {
  legacyJsonToProgress,
  type ProjectProgress,
  projectPathOnThisMachine,
  readAllProjects,
  readProject,
  writeProject,
} from "../hooks/lib/projects";
import { appendSourceLog } from "../tools/knowledge/ingest";
import {
  type Entity,
  type EntityFrontmatter,
  exists as knowledgeExists,
  save as knowledgeSave,
  slugify,
} from "../tools/knowledge/lib";
import { readThreads, type Thread, writeThreads } from "../tools/lib/thread";
import { LEFTOVERS, type Leftover } from "./leftovers";

// ── Types ─────────────────────────────────────────────────────────

interface MigrationResult {
  migrated: number;
  skipped: number;
  results: string[];
}

interface Migration {
  id: string;
  description: string;
  check(): { pending: boolean; detail?: string };
  run(dryRun?: boolean): MigrationResult;
  /** Moves its sources rather than copying them, so there is nothing left to delete. */
  movesSources?: true;
}

// ── v1-projects: JSON progress files → ISA.md ─────────────────────

function pendingJsonFiles(): string[] {
  const progressDir = paths.progress();
  if (!existsSync(progressDir)) return [];
  return readdirSync(progressDir)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !readProject(f.slice(0, -5)));
}

const v1Projects: Migration = {
  id: "v1-projects",
  description: "Migrate legacy JSON progress files to ISA.md format",

  check() {
    const pending = pendingJsonFiles();
    return {
      pending: pending.length > 0,
      detail: pending.length > 0 ? `${pending.length} file(s) in progress/` : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const progressDir = paths.progress();
    const files = pendingJsonFiles();

    let migrated = 0;
    let skipped = 0;
    const results: string[] = [];

    for (const file of files) {
      const slug = file.slice(0, -5);
      const filePath = resolve(progressDir, file);

      try {
        const raw = JSON.parse(readFileSync(filePath, "utf-8"));
        const p = legacyJsonToProgress(raw);
        if (!p) {
          skipped++;
          results.push(`${slug}: skipped (malformed JSON)`);
          continue;
        }
        if (!dryRun) writeProject(p);
        migrated++;
        results.push(`${slug}: ${dryRun ? "would migrate" : "migrated"} (source kept)`);
      } catch {
        skipped++;
        results.push(`${slug}: skipped (read/write error)`);
      }
    }

    return { migrated, skipped, results };
  },
};

// ── v2-threads-to-isc: open threads → ISCs on matching project ────

function nextIscId(criteria: string): number {
  const ids: number[] = [];
  for (const line of criteria.split("\n")) {
    const m = new RegExp(/^-\s+\[[ x~]\]\s+ISC-(\d+):/i).exec(line);
    if (m) ids.push(Number(m[1]));
  }
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

function pendingThreadsForProjects(): { thread: Thread; project: ProjectProgress }[] {
  const threads = readThreads().filter((t) => t.status === "open");
  if (threads.length === 0) return [];
  const projects = readAllProjects();
  const results: { thread: Thread; project: ProjectProgress }[] = [];
  for (const thread of threads) {
    const project = projects.find(
      (p) => p.path !== undefined && resolve(p.path) === resolve(thread.cwd)
    );
    if (project) results.push({ thread, project });
  }
  return results;
}

function addThreadAsIsc(thread: Thread, projectName: string): Thread | null {
  const p = readProject(projectName);
  if (!p) return null;
  const current = p.criteria ?? "";
  const id = nextIscId(current);
  const newLine = `- [ ] ISC-${id}: ${thread.title}`;
  p.criteria = current ? `${current.trimEnd()}\n${newLine}` : newLine;
  p.updated = new Date().toISOString();
  writeProject(p);
  return { ...thread, status: "resolved", resolved: new Date().toISOString() };
}

const v2ThreadsToIsc: Migration = {
  id: "v2-threads-to-isc",
  description: "Migrate open project-scoped threads to ISCs on their project ISA",

  check() {
    const pending = pendingThreadsForProjects();
    return {
      pending: pending.length > 0,
      detail: pending.length > 0 ? `${pending.length} thread(s) to migrate` : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const pending = pendingThreadsForProjects();
    let migrated = 0;
    let skipped = 0;
    const results: string[] = [];

    const threadUpdates: Map<string, Thread> = new Map();

    for (const { thread, project } of pending) {
      try {
        if (!dryRun) {
          const resolvedThread = addThreadAsIsc(thread, project.name);
          if (!resolvedThread) {
            skipped++;
            results.push(`${thread.id}: skipped (project "${project.name}" unreadable)`);
            continue;
          }
          threadUpdates.set(thread.id, resolvedThread);
        }
        migrated++;
        results.push(
          `${thread.id} → ${project.name} ISC: ${dryRun ? "would add" : "added"} "${thread.title}" (thread source kept)`
        );
      } catch {
        skipped++;
        results.push(`${thread.id}: skipped (error)`);
      }
    }

    if (!dryRun && threadUpdates.size > 0) {
      const all = readThreads().map((t) => threadUpdates.get(t.id) ?? t);
      writeThreads(all);
    }

    return { migrated, skipped, results };
  },
};

// ── v3-entities-to-knowledge: entity-index.json → knowledge/*.md ──

interface LegacyPerson {
  id: string;
  name: string;
  first_seen: string;
  occurrences: number;
  source_ids: string[];
}

interface LegacyCompany {
  id: string;
  name: string;
  domain: string | null;
  first_seen: string;
  occurrences: number;
  source_ids: string[];
}

interface LegacyIndex {
  version?: string;
  people?: Record<string, LegacyPerson>;
  companies?: Record<string, LegacyCompany>;
  links?: Record<string, unknown>;
  sources?: Record<string, unknown>;
}

function legacyEntitiesPath(): string {
  // Read from PAL_HOME-aware location to match where the legacy store lived;
  // computed locally now that paths.entities() is being retired alongside this migration.
  const home = palHome();
  const dir = resolve(home, "memory", "entities");
  return resolve(dir, "entity-index.json");
}

function readLegacyIndex(): LegacyIndex | null {
  const p = legacyEntitiesPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as LegacyIndex;
  } catch {
    return null;
  }
}

function countLegacyEntries(idx: LegacyIndex): number {
  return Object.keys(idx.people ?? {}).length + Object.keys(idx.companies ?? {}).length;
}

function legacyPersonToEntity(legacy: LegacyPerson): Entity {
  const fm: EntityFrontmatter = {
    title: legacy.name,
    type: "person",
    tags: [],
    created: legacy.first_seen,
    updated: legacy.first_seen,
    quality: 5,
    status: "seedling",
    related: [],
    legacy_id: legacy.id,
    occurrences: legacy.occurrences,
  };
  let body = "";
  for (const sourceId of legacy.source_ids) {
    body = appendSourceLog(body, sourceId, null, {}, legacy.first_seen);
  }
  return { domain: "People", slug: slugify(legacy.name), frontmatter: fm, body };
}

function legacyCompanyToEntity(legacy: LegacyCompany): Entity {
  const baseKey = legacy.domain?.trim() ? legacy.domain : legacy.name;
  const fm: EntityFrontmatter = {
    title: legacy.name,
    type: "company",
    tags: [],
    created: legacy.first_seen,
    updated: legacy.first_seen,
    quality: 5,
    status: "seedling",
    related: [],
    legacy_id: legacy.id,
    occurrences: legacy.occurrences,
  };
  if (legacy.domain) fm.domain_name = legacy.domain;
  let body = "";
  for (const sourceId of legacy.source_ids) {
    body = appendSourceLog(body, sourceId, null, {}, legacy.first_seen);
  }
  return { domain: "Companies", slug: slugify(baseKey), frontmatter: fm, body };
}

const v3EntitiesToKnowledge: Migration = {
  id: "v3-entities-to-knowledge",
  description: "Migrate legacy entity-index.json to knowledge/{People,Companies}/*.md",

  check() {
    const idx = readLegacyIndex();
    if (!idx) return { pending: false };
    const total = countLegacyEntries(idx);
    if (total === 0) return { pending: false };
    // Skip if every entity already exists in the new store (idempotent).
    let remaining = 0;
    for (const p of Object.values(idx.people ?? {})) {
      if (!knowledgeExists("People", slugify(p.name))) remaining++;
    }
    for (const c of Object.values(idx.companies ?? {})) {
      const key = c.domain?.trim() ? c.domain : c.name;
      if (!knowledgeExists("Companies", slugify(key))) remaining++;
    }
    return {
      pending: remaining > 0,
      detail: remaining > 0 ? `${remaining} of ${total} entries to migrate` : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const idx = readLegacyIndex();
    if (!idx) return { migrated: 0, skipped: 0, results: [] };

    // Refuse to silently drop links/sources if a future legacy index has them.
    const linksCount = Object.keys(idx.links ?? {}).length;
    const sourcesCount = Object.keys(idx.sources ?? {}).length;
    if (linksCount > 0 || sourcesCount > 0) {
      return {
        migrated: 0,
        skipped: linksCount + sourcesCount,
        results: [
          `aborted: legacy index has ${linksCount} link(s) and ${sourcesCount} source(s) — no destination in new store`,
        ],
      };
    }

    const tally: MigrationResult = { migrated: 0, skipped: 0, results: [] };
    const people = Object.values(idx.people ?? {}).map(legacyPersonToEntity);
    const companies = Object.values(idx.companies ?? {}).map(legacyCompanyToEntity);
    for (const entity of [...people, ...companies]) {
      migrateEntity(entity, dryRun, tally);
    }

    if (!dryRun && tally.migrated > 0) archiveLegacyIndex(tally.results);
    return tally;
  },
};

function migrateEntity(entity: Entity, dryRun: boolean, tally: MigrationResult): void {
  const label = `${entity.domain}/${entity.slug}`;
  if (knowledgeExists(entity.domain, entity.slug)) {
    tally.skipped++;
    tally.results.push(`${label}: skipped (already in new store)`);
    return;
  }
  if (!dryRun) knowledgeSave(entity);
  tally.migrated++;
  tally.results.push(`${label}: ${dryRun ? "would migrate" : "migrated"}`);
}

/** So re-runs don't repeatedly load and skip the legacy contents. */
function archiveLegacyIndex(results: string[]): void {
  const src = legacyEntitiesPath();
  if (!existsSync(src)) return;
  const date = new Date().toISOString().slice(0, 10);
  const archived = `${src}.migrated-${date}`;
  try {
    renameSync(src, archived);
    results.push(`archived legacy index → ${archived}`);
  } catch (e) {
    results.push(`warn: could not rename legacy index (${(e as Error).message})`);
  }
}

// ── Registry ──────────────────────────────────────────────────────

// ── v4: project paths out of records, into machine-local bindings ──

/** Records written before bindings existed carry their own `path:` in frontmatter. */
function recordsCarryingAPath(): string[] {
  const base = paths.projectHistory();
  if (!existsSync(base)) return [];
  const out: string[] = [];
  for (const slug of readdirSync(base)) {
    const file = resolve(base, slug, "ISA.md");
    if (!existsSync(file)) continue;
    const frontmatter = readFileSync(file, "utf-8").split("---")[1] ?? "";
    if (/^path:/m.test(frontmatter)) out.push(slug);
  }
  return out;
}

const v4PathsToBindings: Migration = {
  id: "v4-paths-to-bindings",
  description: "Move project paths out of records into machine-local bindings",

  check() {
    const stale = recordsCarryingAPath();
    return {
      pending: stale.length > 0,
      detail:
        stale.length > 0 ? `${stale.length} record(s) still store a path` : undefined,
    };
  },

  // Reading a record and writing it straight back is the whole migration: the
  // writer already routes the path to a binding, drops the field, and picks up
  // the git remote. Nothing here reimplements that, so the two cannot drift.
  run(dryRun = false): MigrationResult {
    const stale = recordsCarryingAPath();
    const results: string[] = [];
    let migrated = 0;
    let skipped = 0;

    for (const slug of stale) {
      const project = readProject(slug);
      if (!project) {
        skipped++;
        results.push(`${slug}: unreadable, left untouched`);
        continue;
      }
      if (dryRun) {
        migrated++;
        results.push(`${slug}: would move ${project.path ?? "(no path)"} to a binding`);
        continue;
      }
      writeProject(project);
      migrated++;
      results.push(`${slug}: path moved to a binding`);
    }

    return { migrated, skipped, results };
  },
};

// ── v5-attribution-keys: m → machine on stored records ─────────────

/**
 * Records stamped their origin as `m`, which nobody could decode without
 * reading the writer. The stamp is now spelled out — machine, actor, runtime,
 * authority — and this brings historical rows onto the same schema, because a
 * mixed schema in an append-only store is exactly what makes it unauditable
 * later. Nothing ever read `m`, so no consumer depends on the old spelling.
 */
function attributionFiles(): string[] {
  const files = [paths.reflectionsFile(), resolve(paths.state(), "threads.jsonl")];
  const signalsDir = paths.signals();
  if (existsSync(signalsDir)) {
    for (const name of readdirSync(signalsDir)) {
      if (name.endsWith(".jsonl")) files.push(resolve(signalsDir, name));
    }
  }
  return files.filter((f) => existsSync(f));
}

/** Lines carrying the old key. A line already using `machine` is left alone. */
function renameAttributionKey(raw: string): { text: string; changed: number } {
  const lines = raw.split("\n");
  let changed = 0;

  const out = lines.map((line) => {
    if (!line.trim()) return line;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return line; // a malformed line is left exactly as found
    }
    if (!("m" in record)) return line;

    const { m, ...rest } = record;
    changed++;
    // `rest` spreads last so a record already carrying `machine` keeps that
    // value and still sheds the stale `m`.
    return JSON.stringify({ machine: m, ...rest });
  });

  return { text: out.join("\n"), changed };
}

function filesCarryingOldKey(): string[] {
  return attributionFiles().filter(
    (f) => renameAttributionKey(readFileSync(f, "utf-8")).changed > 0
  );
}

const v5AttributionKeys: Migration = {
  id: "v5-attribution-keys",
  description: "Rename the origin stamp `m` to `machine` on stored records",

  check() {
    const stale = filesCarryingOldKey();
    return {
      pending: stale.length > 0,
      detail:
        stale.length > 0
          ? `${stale.length} file(s) still stamp origin as \`m\``
          : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const results: string[] = [];
    let migrated = 0;

    for (const file of filesCarryingOldKey()) {
      const { text, changed } = renameAttributionKey(readFileSync(file, "utf-8"));
      const name = file.replace(palHome(), "").replaceAll("\\", "/");
      if (dryRun) {
        results.push(`${name}: would rewrite ${changed} record(s)`);
        migrated++;
        continue;
      }
      writeFileSync(file, text, "utf-8");
      results.push(`${name}: ${changed} record(s) rewritten`);
      migrated++;
    }

    return { migrated, skipped: 0, results };
  },
};

// ── v6-history-slugs: history filed by cwd name → its owning project ──

/**
 * Session history used to be keyed on the last segment of the cwd, so a session
 * in an unregistered directory minted a project-shaped folder, and a project
 * checked out under a differently-named directory had its history filed under
 * that directory instead. Both now route through `historyFileFor`; this brings
 * the records already on disk onto the same rule.
 */
interface StrandedHistory {
  slug: string;
  file: string;
  owner: string | null;
  parked: boolean;
}

function orphanHistoryFolders(): { slug: string; file: string }[] {
  const base = paths.projectHistory();
  if (!existsSync(base)) return [];
  const out: { slug: string; file: string }[] = [];
  for (const slug of readdirSync(base)) {
    const dir = resolve(base, slug);
    const file = resolve(dir, "history.jsonl");
    if (!existsSync(file) || existsSync(resolve(dir, "ISA.md"))) continue;
    out.push({ slug, file });
  }
  return out;
}

function parkedHistoryFiles(): { slug: string; file: string }[] {
  const base = paths.unboundHistory();
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ slug: f.slice(0, -".jsonl".length), file: resolve(base, f) }));
}

/** The project checked out in a directory of this name, when exactly one is. */
function projectOwningDirectoryNamed(slug: string): string | null {
  const bindings = readBindings();
  const owners = readAllProjects().filter((p) => {
    const path = projectPathOnThisMachine(p, bindings);
    return path !== null && basename(path) === slug;
  });
  return owners.length === 1 ? owners[0].name : null;
}

/** Orphans always move; parked history moves only once its project appears. */
function strandedHistory(): StrandedHistory[] {
  const out: StrandedHistory[] = [];
  for (const { slug, file } of orphanHistoryFolders()) {
    out.push({ slug, file, owner: projectOwningDirectoryNamed(slug), parked: false });
  }
  for (const { slug, file } of parkedHistoryFiles()) {
    const owner = projectOwningDirectoryNamed(slug);
    if (owner) out.push({ slug, file, owner, parked: true });
  }
  return out;
}

function destinationFor(item: StrandedHistory): string {
  return item.owner
    ? resolve(paths.projectHistory(), item.owner, "history.jsonl")
    : resolve(paths.unboundHistory(), `${item.slug}.jsonl`);
}

function discardEmptyFolder(dir: string): void {
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    /* left in place — never worth failing a migration over */
  }
}

const v6HistorySlugs: Migration = {
  id: "v6-history-slugs",
  description: "Re-file session history keyed on a cwd name onto its owning project",
  movesSources: true,

  check() {
    const stranded = strandedHistory();
    return {
      pending: stranded.length > 0,
      detail:
        stranded.length > 0
          ? `${stranded.length} history file(s) filed under a directory name`
          : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const results: string[] = [];
    let migrated = 0;
    let skipped = 0;

    for (const item of strandedHistory()) {
      const target = destinationFor(item);
      const where = item.owner ? `project ${item.owner}` : "unbound-history";
      if (dryRun) {
        migrated++;
        results.push(`${item.slug}: would move to ${where}`);
        continue;
      }
      try {
        const added = foldHistoryInto(target, item.file);
        unlinkSync(item.file);
        if (!item.parked) discardEmptyFolder(dirname(item.file));
        migrated++;
        results.push(`${item.slug}: ${added} entr(ies) moved to ${where}`);
      } catch (e) {
        skipped++;
        results.push(`${item.slug}: skipped (${(e as Error).message})`);
      }
    }

    return { migrated, skipped, results };
  },
};

// ── v7-retired-settings-keys: keys older settings templates wrote ──

const RETIRED_SETTINGS_KEYS: Record<string, string[]> = {
  loadAtStartup: ["_docs"],
  steering: ["_docs"],
  dynamicContext: [
    "_docs",
    "learningDigest",
    "projectHistory",
    "sessionIntelligence",
    "synthesis",
    "signalTrends",
    "activeWork",
    "failurePatterns",
    "learningInjection",
    "wisdom",
    "relationship",
    "selfModel",
    "handoff",
    "workTree",
    "workTreeGate",
    "workTreeDecisionGate",
    "progressTree",
    "progressTreeGate",
    "progressTreeDecisionGate",
  ],
};

function settingsFile(): string {
  return resolve(paths.memory(), "pal-settings.json");
}

function readSettingsObject(): Record<string, Record<string, unknown>> | null {
  try {
    const settings = JSON.parse(readFileSync(settingsFile(), "utf-8"));
    return typeof settings === "object" && settings !== null ? settings : null;
  } catch {
    return null;
  }
}

function writeSettingsObject(settings: Record<string, Record<string, unknown>>): void {
  writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

export function retiredKeysIn(
  settings: Record<string, Record<string, unknown>>
): string[] {
  return Object.entries(RETIRED_SETTINGS_KEYS).flatMap(([section, keys]) => {
    const value = settings[section];
    if (typeof value !== "object" || value === null) return [];
    return keys.filter((key) => key in value).map((key) => `${section}.${key}`);
  });
}

const v7RetiredSettingsKeys: Migration = {
  id: "v7-retired-settings-keys",
  description: "Remove settings older templates wrote that PAL no longer reads",

  check() {
    const settings = readSettingsObject();
    const retired = settings ? retiredKeysIn(settings) : [];
    return {
      pending: retired.length > 0,
      detail: retired.length > 0 ? retired.join(", ") : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const settings = readSettingsObject();
    const retired = settings ? retiredKeysIn(settings) : [];
    if (!settings || retired.length === 0)
      return { migrated: 0, skipped: 0, results: [] };
    if (!dryRun) {
      for (const path of retired) {
        const [section, key] = path.split(".");
        delete settings[section][key];
      }
      writeSettingsObject(settings);
    }
    const verb = dryRun ? "would remove" : "removed";
    return {
      migrated: retired.length,
      skipped: 0,
      results: [`pal-settings.json: ${verb} ${retired.join(", ")}`],
    };
  },
};

function leftoverMigration(leftover: Leftover): Migration {
  return {
    id: leftover.id,
    description: leftover.description,
    movesSources: true,
    check() {
      const found = leftover.find();
      return { pending: found.length > 0, detail: found.join(", ") || undefined };
    },
    run(dryRun = false): MigrationResult {
      const found = leftover.find();
      if (found.length === 0) return { migrated: 0, skipped: 0, results: [] };
      if (!dryRun) leftover.remove();
      const verb = dryRun ? "would remove" : "removed";
      return {
        migrated: found.length,
        skipped: 0,
        results: [`${verb} ${found.join(", ")}`],
      };
    },
  };
}

// ── v8-factory-home: the factory's folder, out of the PAL home ────

/**
 * PAL used to point the factory at `<PAL home>/dark-factory`, which put its git
 * worktrees under the PAL home. The factory keeps its folder at `~/.dark-factory`
 * on every machine, so this carries an install's tasks, worktrees and events
 * there. Nothing is overwritten: an item already in the new folder is left where
 * it is and reported as skipped, and event lines are appended.
 */
interface FactoryStep {
  label: string;
  blocked: string | null;
  done: string;
  pending: string;
  apply(): void;
}

const oldFactoryFolder = () => resolve(palHome(), "dark-factory");
function homeTheFactoryReads(): string | null {
  const pinned = process.env.DARK_FACTORY_HOME;
  return pinned && resolve(pinned) !== oldFactoryFolder() ? resolve(pinned) : null;
}

const newFactoryFolder = () =>
  homeTheFactoryReads() ?? resolve(homedir(), ".dark-factory");
const oldFactoryEvents = () => resolve(oldFactoryFolder(), "events.jsonl");

function subfoldersOf(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}

function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || "git failed").trim().split("\n")[0]);
  }
  return result.stdout.trim();
}

/** Moves a worktree and rewrites its registration in the repo that owns it. */
function moveWorktree(from: string, to: string): void {
  const commonDir = git(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    from
  );
  git(["--git-dir", commonDir, "worktree", "move", from, to], dirname(commonDir));
}

function repointWorktreeInTask(taskDir: string): void {
  const file = resolve(taskDir, "task.json");
  if (!existsSync(file)) return;
  let task: { worktree?: unknown };
  try {
    task = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return;
  }
  const oldPrefix = resolve(oldFactoryFolder(), "worktrees");
  if (typeof task.worktree !== "string" || !task.worktree.startsWith(oldPrefix)) return;
  const relative = task.worktree.slice(oldPrefix.length);
  task.worktree = resolve(newFactoryFolder(), "worktrees") + relative;
  writeFileSync(file, `${JSON.stringify(task, null, 2)}\n`, "utf-8");
}

function factoryFolderStep(kind: "task" | "worktree", id: string): FactoryStep {
  const from = resolve(oldFactoryFolder(), `${kind}s`, id);
  const to = resolve(newFactoryFolder(), `${kind}s`, id);
  return {
    label: `${kind}/${id}`,
    blocked: existsSync(to) ? `already in ${newFactoryFolder()}` : null,
    done: "moved",
    pending: "would move",
    apply() {
      mkdirSync(dirname(to), { recursive: true });
      if (kind === "worktree") return moveWorktree(from, to);
      renameSync(from, to);
      repointWorktreeInTask(to);
    },
  };
}

function eventsStep(): FactoryStep {
  const target = resolve(newFactoryFolder(), "events.jsonl");
  return {
    label: "events.jsonl",
    blocked: null,
    done: "appended",
    pending: "would append",
    apply() {
      foldHistoryInto(target, oldFactoryEvents());
      unlinkSync(oldFactoryEvents());
    },
  };
}

function factoryFolderSteps(): FactoryStep[] {
  const old = oldFactoryFolder();
  const steps = [
    ...subfoldersOf(resolve(old, "worktrees")).map((id) =>
      factoryFolderStep("worktree", id)
    ),
    ...subfoldersOf(resolve(old, "tasks")).map((id) => factoryFolderStep("task", id)),
  ];
  return existsSync(oldFactoryEvents()) ? [...steps, eventsStep()] : steps;
}

function discardEmptyFactoryFolders(): void {
  const old = oldFactoryFolder();
  for (const sub of ["worktrees", "tasks"]) discardEmptyFolder(resolve(old, sub));
  discardEmptyFolder(old);
}

const v8FactoryHome: Migration = {
  id: "v8-factory-home",
  description: "Move the dark-factory folder from the PAL home to ~/.dark-factory",
  movesSources: true,

  check() {
    const steps = factoryFolderSteps().filter((step) => !step.blocked);
    return {
      pending: steps.length > 0,
      detail:
        steps.length > 0
          ? `${steps.length} item(s) under ${oldFactoryFolder()}`
          : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const results: string[] = [];
    let migrated = 0;
    let skipped = 0;

    for (const step of factoryFolderSteps()) {
      if (step.blocked) {
        skipped++;
        results.push(`${step.label}: skipped (${step.blocked})`);
        continue;
      }
      if (dryRun) {
        migrated++;
        results.push(`${step.label}: ${step.pending}`);
        continue;
      }
      try {
        step.apply();
        migrated++;
        results.push(`${step.label}: ${step.done}`);
      } catch (e) {
        skipped++;
        results.push(`${step.label}: skipped (${(e as Error).message})`);
      }
    }

    if (!dryRun) discardEmptyFactoryFolders();
    return { migrated, skipped, results };
  },
};

// ── v9-progress-tree-names: the progress tree's stored names ────

const EVENTS_FILE = "events.jsonl";
const OLD_PROGRESS_TREE_LABEL = "memory/work-tree/";
const oldProgressTreeFolder = () => resolve(paths.memory(), "work-tree");
const newProgressTreeFolder = () => resolve(paths.memory(), "progress-tree");

interface FolderStep {
  results: string[];
  skipped: number;
}

function mergeOldProgressTreeEvents(): number {
  const oldFile = resolve(oldProgressTreeFolder(), EVENTS_FILE);
  if (!existsSync(oldFile)) return 0;
  const newFile = resolve(newProgressTreeFolder(), EVENTS_FILE);
  const newRaw = existsSync(newFile) ? readFileSync(newFile, "utf-8") : "";
  const { text, added: keptFromNew } = mergeJsonlLines(
    readFileSync(oldFile, "utf-8"),
    newRaw
  );
  writeFileSync(newFile, text, "utf-8");
  unlinkSync(oldFile);
  return text.split("\n").filter(Boolean).length - keptFromNew;
}

function appendOldProgressTree(): FolderStep {
  const appended = mergeOldProgressTreeEvents();
  discardEmptyFolder(oldProgressTreeFolder());
  const results = [
    `${OLD_PROGRESS_TREE_LABEL}: ${appended} event(s) appended before memory/progress-tree/events.jsonl`,
  ];
  if (!existsSync(oldProgressTreeFolder())) return { results, skipped: 0 };
  return {
    results: [
      ...results,
      `${OLD_PROGRESS_TREE_LABEL}: skipped (holds files other than events.jsonl)`,
    ],
    skipped: 1,
  };
}

function progressTreeFolderStep(dryRun: boolean): FolderStep {
  if (!existsSync(oldProgressTreeFolder())) return { results: [], skipped: 0 };
  const bothExist = existsSync(newProgressTreeFolder());
  if (dryRun) {
    const verb = bothExist
      ? "would append its events before memory/progress-tree/events.jsonl"
      : "would move to memory/progress-tree/";
    return { results: [`${OLD_PROGRESS_TREE_LABEL}: ${verb}`], skipped: 0 };
  }
  try {
    if (!bothExist) {
      renameSync(oldProgressTreeFolder(), newProgressTreeFolder());
      return {
        results: [`${OLD_PROGRESS_TREE_LABEL}: moved to memory/progress-tree/`],
        skipped: 0,
      };
    }
    return appendOldProgressTree();
  } catch (e) {
    return {
      results: [`${OLD_PROGRESS_TREE_LABEL}: skipped (${(e as Error).message})`],
      skipped: 1,
    };
  }
}

const v9ProgressTreeNames: Migration = {
  id: "v9-progress-tree-names",
  description: "Move the progress tree's data folder from memory/work-tree",
  movesSources: true,

  check() {
    const pending = existsSync(oldProgressTreeFolder());
    return { pending, detail: pending ? OLD_PROGRESS_TREE_LABEL : undefined };
  },

  run(dryRun = false): MigrationResult {
    const { results, skipped } = progressTreeFolderStep(dryRun);
    return { migrated: results.length - skipped, skipped, results };
  },
};

// ── v10-threads-to-progress-tree: open threads → parked nodes ────

function nodeOf(line: string): string[] {
  try {
    const { node } = JSON.parse(line);
    return typeof node === "string" ? [node] : [];
  } catch {
    return [];
  }
}

function progressTreeNodeIds(): Set<string> {
  const file = resolve(newProgressTreeFolder(), EVENTS_FILE);
  if (!existsSync(file)) return new Set();
  return new Set(readFileSync(file, "utf-8").split("\n").flatMap(nodeOf));
}

function openThreadsNotInTree(): Thread[] {
  const nodes = progressTreeNodeIds();
  return readThreads().filter((t) => t.status === "open" && !nodes.has(t.id));
}

function threadScope(cwd: string): string {
  const anchor = resolveAnchor(cwd);
  return anchor.state === "unresolvable" ? anchor.slug : scopeOf(anchor.path);
}

function openedAt(thread: Thread): Date {
  const created = new Date(thread.created);
  return Number.isNaN(created.getTime()) ? new Date() : created;
}

const laneNoSessionHeld = (thread: Thread) => `thread-${thread.id}`;

function parkThread(thread: Thread): void {
  const scope = threadScope(thread.cwd);
  const at = openedAt(thread);
  const lane = laneNoSessionHeld(thread);
  const open = { title: thread.title, parent: null };
  const park = { stoppedAt: thread.context || undefined };
  appendEvent(scope, thread.id, "open", open, undefined, at, lane);
  appendEvent(scope, thread.id, "park", park, undefined, at, lane);
}

const v10ThreadsToProgressTree: Migration = {
  id: "v10-threads-to-progress-tree",
  description: "Park every open thread as a node in the progress tree",

  check() {
    const pending = openThreadsNotInTree();
    return {
      pending: pending.length > 0,
      detail: pending.length > 0 ? `${pending.length} open thread(s)` : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const results: string[] = [];
    let skipped = 0;
    for (const thread of openThreadsNotInTree()) {
      try {
        if (!dryRun) parkThread(thread);
        results.push(
          `${thread.id}: ${dryRun ? "would park" : "parked"} "${thread.title}" in ${threadScope(thread.cwd)} (thread source kept)`
        );
      } catch (e) {
        skipped++;
        results.push(`${thread.id}: skipped (${(e as Error).message})`);
      }
    }
    return { migrated: results.length - skipped, skipped, results };
  },
};

const MIGRATIONS: Migration[] = [
  v1Projects,
  v2ThreadsToIsc,
  v3EntitiesToKnowledge,
  v4PathsToBindings,
  v5AttributionKeys,
  v6HistorySlugs,
  v7RetiredSettingsKeys,
  v8FactoryHome,
  v9ProgressTreeNames,
  v10ThreadsToProgressTree,
  ...LEFTOVERS.map(leftoverMigration),
];

// ── Public API ────────────────────────────────────────────────────

interface PendingMigration {
  id: string;
  description: string;
  detail?: string;
}

/** Install runs these first, so one install leaves nothing an older PAL wrote. */
export function applyPendingMigrations(): string[] {
  return MIGRATIONS.filter((m) => m.check().pending).flatMap((m) =>
    m.run(false).results.map((line) => `${m.id}: ${line}`)
  );
}

/** Returns migrations that have pending work. Used by doctor. */
export function checkPendingMigrations(): PendingMigration[] {
  return MIGRATIONS.flatMap((m) => {
    const { pending, detail } = m.check();
    return pending ? [{ id: m.id, description: m.description, detail }] : [];
  });
}

function printMigrationList(): void {
  const pending = checkPendingMigrations();
  const done = MIGRATIONS.filter((m) => !m.check().pending);

  console.log("");
  if (pending.length > 0) {
    console.log("  Pending migrations:");
    for (const m of pending) {
      const detail = m.detail ? ` (${m.detail})` : "";
      console.log(`    ⚠ ${m.id} — ${m.description}${detail}`);
    }
  } else {
    console.log("  No pending migrations.");
  }
  if (done.length > 0) {
    console.log("  Done:");
    for (const m of done) {
      console.log(`    ✓ ${m.id} — ${m.description}`);
    }
  }
  console.log("");
}

/** Entry point for `pal cli migrate`. */
export function runMigrate(args: string[]): void {
  const dryRun = args.includes("--dry-run");
  const list = args.includes("--list");

  if (list) {
    printMigrationList();
    return;
  }

  const pending = MIGRATIONS.filter((m) => m.check().pending);
  if (pending.length === 0) {
    console.log("  Nothing to migrate — all up to date.");
    return;
  }

  if (dryRun) console.log("  Dry run — no files will be written.\n");

  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const m of pending) {
    console.log(`  Running: ${m.id} — ${m.description}`);
    const result = m.run(dryRun);
    totalMigrated += result.migrated;
    totalSkipped += result.skipped;
    for (const r of result.results) {
      console.log(`    ${r}`);
    }
  }

  console.log("");
  console.log(
    `  ${dryRun ? "Would migrate" : "Migrated"}: ${totalMigrated} | Skipped: ${totalSkipped}`
  );
  if (!dryRun && totalMigrated > 0 && pending.some((m) => !m.movesSources)) {
    console.log("  Source files preserved — delete manually once verified.");
  }
  console.log("");
}

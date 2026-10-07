#!/usr/bin/env bun
/**
 * Project — register and manage user projects via ISA.md files.
 *
 * Each project is stored at `~/.pal/memory/projects/{slug}/ISA.md`.
 * Frontmatter holds operational state; body holds ISA spec sections.
 *
 * Usage: pal cli project <command> --help
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeBinding } from "../../hooks/lib/bindings";
import { paths, toPath } from "../../hooks/lib/paths";
import {
  defaultSlug,
  deleteProject,
  isStale,
  legacyJsonToProgress,
  type ProjectProgress,
  type ProjectStatus,
  proposeBinding,
  readAllProjects,
  readProject,
  type ServesKind,
  writeProject,
} from "../../hooks/lib/projects";
import { isServesKind, SERVES_KINDS, setServes } from "../../hooks/lib/serves";
import { group, type Leaf, leaf, runCommand, UsageError } from "../lib/command";
import {
  archiveLine,
  completeIsc,
  encodeIscText,
  ISC_BOX,
  type IscMove,
  type IscSections,
  iscTitle,
  nextIscId,
  parseIscs,
  removeIscLine,
  reopenIsc,
  selectIscs,
  taskSlug,
} from "../lib/project-isc";
import { scriptArgs } from "../lib/script-args";

function now(): string {
  return new Date().toISOString();
}

function fail(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

function ok(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload, null, 2));
}

function requireProject(name: string): ProjectProgress {
  const p = readProject(name);
  if (!p) fail(`No project named "${name}". Run 'list' to see registered projects.`);
  return p as ProjectProgress;
}

// ── argument values ───────────────────────────────────────────────

function positiveId(value: string, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw new UsageError(`${label} must be a positive integer, got "${value}"`);
  }
  return id;
}

function listIndex(value: string): number {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0) {
    throw new UsageError(`<index> must be a non-negative integer, got "${value}"`);
  }
  return index;
}

function nonBlank(text: string, slot: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new UsageError(`${slot} is empty`);
  return trimmed;
}

function servesKind(value: string, label: string): ServesKind {
  if (!isServesKind(value)) {
    throw new UsageError(`${label} must be one of: ${SERVES_KINDS.join(", ")}`);
  }
  return value;
}

// ── list ──────────────────────────────────────────────────────────

function cmdList(): undefined {
  const all = readAllProjects().sort((a, b) => b.updated.localeCompare(a.updated));
  const rows = all.map((p) => ({
    name: p.name,
    status: p.status,
    path: p.path,
    updated: p.updated,
    stale: isStale(p),
    next: p.next?.length ?? 0,
    blockers: p.blockers?.length ?? 0,
  }));
  ok({ count: all.length, projects: rows });
}

// ── create ────────────────────────────────────────────────────────

interface CreateValues {
  path?: string;
  name?: string;
  objectives?: string;
  serves?: string;
  "serves-note"?: string;
}

function projectName(
  positional: string | undefined,
  flag: string | undefined
): string | undefined {
  if (positional !== undefined && flag !== undefined) {
    throw new UsageError("give the name once: as [name] or as --name");
  }
  return positional ?? flag;
}

function cmdCreate(given: string | undefined, values: CreateValues): undefined {
  const path = toPath(values.path ?? process.cwd());
  const name = (given ?? defaultSlug(path)).trim();

  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw new UsageError(
      `Invalid project name "${name}". Use lowercase letters, digits, hyphens, underscores.`
    );
  }
  const serves =
    values.serves === undefined ? undefined : servesKind(values.serves, "--serves");

  if (readProject(name)) {
    fail(
      `Project "${name}" already exists. Pick a different --name or run 'resume ${name}' to inspect.`
    );
  }

  const goalLines = values.objectives
    ? values.objectives
        .split(/[\n;|]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => `- ${s}`)
        .join("\n")
    : undefined;

  const project: ProjectProgress = {
    name,
    path,
    status: "active",
    created: now(),
    updated: now(),
    ...(goalLines ? { goal: goalLines } : {}),
    ...(serves ? { serves, serves_by: "user" as const } : {}),
    ...(values["serves-note"] ? { serves_note: values["serves-note"] } : {}),
  };
  writeProject(project);
  ok({ created: true, project });
}

/** The answer the scaffolder asks for, and the one place importance can be corrected. */
function cmdServes(name: string, kind: ServesKind, note: string): undefined {
  const outcome = setServes({
    name,
    kind,
    note: note.trim() || undefined,
    by: "user",
  });
  if (outcome === "missing") fail(`No project named "${name}".`);
  ok({ project: name, serves: kind, by: "user" });
}

// ── resume ────────────────────────────────────────────────────────

// resume returns a lean orientation view: all narrative sections, but the
// Criteria/Changelog blobs collapse to open-ISC titles + counts. Full ISC text
// is fetched on demand via show-isc / list-isc, so resume stays cheap on
// projects carrying a large backlog.
function cmdResume(name: string): undefined {
  const { criteria, changelog, ...project } = requireProject(name);
  const iscs = parseIscs(criteria ?? "");
  const archived = parseIscs(changelog ?? "");
  const openIscs = iscs.filter((i) => i.status === "open");
  const all = [...iscs, ...archived];
  const done = all.filter((i) => i.status === "done").length;
  const retired = all.filter((i) => i.status === "retired").length;
  // Resuming a project PAL cannot locate is the natural moment to offer a
  // binding: the user just named this project, so the suggestion is wanted rather
  // than volunteered. It is only ever a command — nothing binds on its own.
  const unlocatable = !project.path || !existsSync(project.path);
  const binding = unlocatable
    ? proposeBinding({ ...project, criteria, changelog })
    : null;

  ok({
    project: {
      ...project,
      open_iscs: openIscs.map((i) => ({ id: i.id, title: iscTitle(i.text) })),
      isc_summary: { open: openIscs.length, done, retired },
    },
    ...(unlocatable
      ? { binding: binding ?? { state: "unbound", confidence: "none" } }
      : {}),
  });
}

// ── status transitions ────────────────────────────────────────────

function setStatus(name: string, status: ProjectStatus): undefined {
  const p = requireProject(name);
  p.status = status;
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name, status });
}

// ── append/remove for array fields ───────────────────────────────

function appendItem(name: string, field: "next" | "blockers", text: string): undefined {
  const item = nonBlank(text, `${field} text`);
  const p = requireProject(name);
  const list = p[field] ?? [];
  list.push(item);
  p[field] = list;
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name, field, count: list.length });
}

function removeItem(name: string, field: "next" | "blockers", idx: number): undefined {
  const p = requireProject(name);
  const list = p[field] ?? [];
  if (idx >= list.length) fail(`Index ${idx} out of range (length ${list.length}).`);
  const removed = list.splice(idx, 1)[0];
  p[field] = list;
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name, field, removed, count: list.length });
}

// ── decisions (body section append) ──────────────────────────────

function addDecision(name: string, decision: string, rationale: string): undefined {
  const what = nonBlank(decision, "<decision>");
  const why = nonBlank(rationale, "<rationale...>");
  const p = requireProject(name);
  const date = new Date().toISOString().slice(0, 10);
  const line = `- ${date}: ${what} (${why})`;
  p.decisions = p.decisions ? `${p.decisions}\n${line}` : line;
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name });
}

// ── handoff ───────────────────────────────────────────────────────

function addHandoff(name: string, text: string): undefined {
  const handoff = nonBlank(text, "handoff text");
  const p = requireProject(name);
  p.handoff = handoff;
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name });
}

// ── set-path ──────────────────────────────────────────────────────

// Where a project lives is machine-local, so this writes a binding rather than a
// field on the record. Unlike the save path it does not require the directory to
// exist yet: naming where a repo is about to be cloned is a legitimate use.
function cmdSetPath(name: string, rawPath: string): undefined {
  const newPath = toPath(nonBlank(rawPath, "<path...>"));
  const p = requireProject(name);
  writeBinding(p.name, newPath);
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name, path: newPath });
}

// ── update-section ────────────────────────────────────────────────

const VALID_SECTIONS = [
  "problem",
  "goal",
  "criteria",
  "vision",
  "constraints",
  "out_of_scope",
  "context",
  "decisions",
  "changelog",
] as const;
type Section = (typeof VALID_SECTIONS)[number];

function sectionKey(section: string): Section {
  const key = section.toLowerCase().replace(/\s+/g, "_");
  if (!(VALID_SECTIONS as readonly string[]).includes(key)) {
    throw new UsageError(
      `Unknown section "${section}". Valid: ${VALID_SECTIONS.join(", ")}`
    );
  }
  return key as Section;
}

function cmdUpdateSection(name: string, section: string, text: string): undefined {
  const key = sectionKey(section);
  const content = nonBlank(text, "<content...>");
  const p = requireProject(name);
  (p as unknown as Record<string, unknown>)[key] = content;
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name, section: key });
}

// ── criteria ──────────────────────────────────────────────────────

function cmdCriteria(name: string): undefined {
  const p = requireProject(name);
  ok({ name, criteria: p.criteria ?? "" });
}

// ── isa-init ──────────────────────────────────────────────────────

function cmdIsaInit(name: string): undefined {
  const p = requireProject(name);
  const sections: Array<keyof ProjectProgress> = [
    "problem",
    "goal",
    "criteria",
    "vision",
    "constraints",
    "out_of_scope",
    "context",
  ];
  let scaffolded = 0;
  const pr = p as unknown as Record<string, unknown>;
  for (const s of sections) {
    if (!pr[s as string]) {
      pr[s as string] = "";
      scaffolded++;
    }
  }
  // Remove empty strings so they don't clutter the ISA body
  for (const s of sections) {
    if (pr[s as string] === "") pr[s as string] = undefined;
  }
  p.updated = now();
  writeProject(p);
  ok({ initialized: true, name, scaffolded });
}

// ── migrate (from old JSON format) ───────────────────────────────

function cmdMigrate(): undefined {
  const progressDir = paths.progress();
  if (!existsSync(progressDir)) {
    ok({ migrated: 0, skipped: 0, results: [] });
    return;
  }

  const files = readdirSync(progressDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    ok({ migrated: 0, skipped: 0, results: [] });
    return;
  }

  let migrated = 0;
  let skipped = 0;
  const results: string[] = [];

  for (const file of files) {
    const slug = file.slice(0, -5);
    const filePath = resolve(progressDir, file);

    if (readProject(slug)) {
      skipped++;
      results.push(`${slug}: skipped (ISA.md already exists)`);
      continue;
    }

    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8"));
      const p = legacyJsonToProgress(raw);
      if (!p) {
        skipped++;
        results.push(`${slug}: skipped (malformed JSON)`);
        continue;
      }
      writeProject(p);
      migrated++;
      results.push(`${slug}: migrated`);
    } catch {
      skipped++;
      results.push(`${slug}: skipped (read/write error)`);
    }
  }

  ok({ migrated, skipped, results });
}

// ── rm (project) ──────────────────────────────────────────────────

function cmdRm(name: string): undefined {
  const removed = deleteProject(name);
  if (!removed) fail(`No project named "${name}".`);
  ok({ deleted: true, name });
}

// ── ISC helpers ──────────────────────────────────────────────────

// Three states, not two: a retired ISC is one that stopped being valid, which the
// record must not report as completed work. The box character is the storage form
// and the id stays in it, so a retired line keeps reserving its id in nextIscId.
function cmdAddIsc(name: string, text: string): undefined {
  const title = nonBlank(text, "<title...>");
  const p = requireProject(name);
  const current = p.criteria ?? "";
  const id = nextIscId(current, p.changelog ?? "");
  const newLine = `- [ ] ISC-${id}: ${encodeIscText(title)}`;
  p.criteria = current ? `${current.trimEnd()}\n${newLine}` : newLine;
  p.updated = now();
  writeProject(p);
  ok({
    added: true,
    id,
    title,
    announce: `🎟️ ISC #${id} — ${title}`,
    reminder:
      "Surface the `announce` line to the user verbatim, on its own line. Every ISC you open MUST be announced with the 🎟️ ticket marker, in any response mode — omitting it is a defect.",
  });
}

// Completing an ISC moves its line out of Criteria and into the dated Changelog
// archive, so Criteria stays exactly the open set and never re-bloats context.
function cmdCompleteIsc(name: string, id: number): undefined {
  const p = requireProject(name);
  const move = completeIsc(sectionsOf(p), id);
  if (!move.ok) fail(`${move.reason} in project "${name}"`);
  if (move.already) {
    ok({ checked: true, id, alreadyDone: true });
    return;
  }
  applyIscMove(p, move);
  ok({ checked: true, id, archived: true });
}

function sectionsOf(p: ProjectProgress): IscSections {
  return { criteria: p.criteria ?? "", changelog: p.changelog ?? "" };
}

function applyIscMove(p: ProjectProgress, move: IscMove & { ok: true }): void {
  p.criteria = move.criteria;
  p.changelog = move.changelog;
  p.updated = now();
  writeProject(p);
}

// Reopening pulls the line back out of the Changelog (or legacy Criteria) into
// the open set.
function cmdReopenIsc(name: string, id: number): undefined {
  const p = requireProject(name);
  const move = reopenIsc(sectionsOf(p), id);
  if (!move.ok) fail(`${move.reason} in project "${name}"`);
  if (move.already) {
    ok({ checked: false, id, alreadyOpen: true });
    return;
  }
  applyIscMove(p, move);
  ok({ checked: false, id });
}

interface IscListFlags {
  all?: boolean;
  closed?: boolean;
  retired?: boolean;
}

function iscListFlag(flags: IscListFlags): Set<string> {
  const chosen = Object.entries(flags)
    .filter(([, on]) => on)
    .map(([flag]) => `--${flag}`);
  if (chosen.length > 1) {
    throw new UsageError(`${chosen.join(" and ")} cannot be combined; pick one`);
  }
  return new Set(chosen);
}

function cmdListIsc(name: string, flags: Set<string>): undefined {
  const p = requireProject(name);
  const criteria = parseIscs(p.criteria ?? "");
  const all = [...criteria, ...parseIscs(p.changelog ?? "")];
  const open = all.filter((i) => i.status === "open");
  const done = all.filter((i) => i.status === "done");
  const retired = all.filter((i) => i.status === "retired");
  ok({
    name,
    total: open.length + done.length + retired.length,
    open: open.length,
    done: done.length,
    retired: retired.length,
    iscs: selectIscs(open, done, retired, flags),
  });
}

// show-isc prints one ISC's full text on demand — the "detail" counterpart to
// resume's titles. Scans Criteria (open + not-yet-archived) and Changelog.
function cmdShowIsc(name: string, id: number): undefined {
  const p = requireProject(name);
  const isc = [...parseIscs(p.criteria ?? ""), ...parseIscs(p.changelog ?? "")].find(
    (i) => i.id === id
  );
  if (!isc) fail(`ISC-${id} not found in project "${name}".`);
  ok({ name, id: isc.id, status: isc.status, text: isc.text });
}

// retire-isc closes an ISC that stopped being valid, which complete-isc cannot say:
// completing files it as done work. The line moves to the Changelog under its own
// heading as [~], so it still reserves its id and never reads as finished.
function cmdRetireIsc(name: string, id: number, by: number | null): undefined {
  const p = requireProject(name);
  if (parseIscs(p.changelog ?? "").some((i) => i.id === id && i.status === "retired")) {
    ok({ retired: true, id, alreadyRetired: true });
    return;
  }
  const { line, rest } = removeIscLine(p.criteria ?? "", id);
  if (!line) fail(`ISC-${id} not found in project "${name}"`);
  const suffix = by ? ` (superseded by ISC-${by})` : "";
  p.criteria = rest;
  p.changelog = archiveLine(
    p.changelog,
    `${line.replace(/\[[ x]\]/i, "[~]")}${suffix}`,
    "Retired"
  );
  p.updated = now();
  writeProject(p);
  ok({ retired: true, id, supersededBy: by, archived: true });
}

// edit-isc rewrites one ISC's text in place, keeping its id and open/done state.
// The id never leaves the record, so nextIscId still reserves it. Returns the
// previous text because the ISA files carry no version history of their own.
function cmdEditIsc(name: string, id: number, newText: string): undefined {
  const text = nonBlank(newText, "<text...>");
  const p = requireProject(name);
  const inCriteria = parseIscs(p.criteria ?? "").find((i) => i.id === id);
  const isc = inCriteria ?? parseIscs(p.changelog ?? "").find((i) => i.id === id);
  if (!isc) fail(`ISC-${id} not found in project "${name}".`);

  const box = ISC_BOX[isc.status];
  const rewrite = (section: string) =>
    section
      .split("\n")
      .map((l) =>
        new RegExp(String.raw`^-\s+\[[ x~]\]\s+ISC-${id}:`, "i").test(l)
          ? `- ${box} ISC-${id}: ${encodeIscText(text)}`
          : l
      )
      .join("\n");

  if (inCriteria) p.criteria = rewrite(p.criteria ?? "");
  else p.changelog = rewrite(p.changelog ?? "");
  p.updated = now();
  writeProject(p);
  ok({
    edited: true,
    id,
    status: isc.status,
    previous: isc.text,
    text,
  });
}

// Backfill: sweep any done ISCs still sitting in Criteria (legacy projects, or
// completions from before archive-on-complete) into the Changelog in one pass.
function cmdPruneIsc(name: string): undefined {
  const p = requireProject(name);
  const done = parseIscs(p.criteria ?? "").filter((i) => i.status !== "open");
  for (const isc of done) {
    const { line, rest } = removeIscLine(p.criteria ?? "", isc.id);
    if (!line) continue;
    p.criteria = rest;
    p.changelog = archiveLine(p.changelog, line);
  }
  if (done.length > 0) {
    p.updated = now();
    writeProject(p);
  }
  const openLeft = parseIscs(p.criteria ?? "").filter((i) => i.status === "open").length;
  ok({ pruned: done.length, name, remaining_open: openLeft });
}

// ── Task ISA (work/) ──────────────────────────────────────────────

function taskIsaPath(slug: string): string {
  const dir = resolve(paths.work(), slug);
  mkdirSync(dir, { recursive: true });
  return resolve(dir, "ISA.md");
}

function cmdScaffoldTaskIsa(text: string): undefined {
  const title = nonBlank(text, "<title...>");
  const slug = taskSlug(title);
  const ts = new Date().toISOString();
  const content = [
    "---",
    `task: "${title}"`,
    `slug: "${slug}"`,
    "phase: active",
    `started: "${ts}"`,
    `updated: "${ts}"`,
    "---",
    "",
    "## Goal",
    "",
    "",
    "## Criteria",
    "",
    "",
  ].join("\n");
  const filePath = taskIsaPath(slug);
  writeFileSync(filePath, content, "utf-8");
  ok({ created: true, slug, path: filePath });
}

function cmdCompleteTaskIsa(slug: string): undefined {
  const filePath = resolve(paths.work(), slug, "ISA.md");
  if (!existsSync(filePath)) fail(`Task ISA not found: ${slug}`);
  const content = readFileSync(filePath, "utf-8");
  const updated = content
    .replace(/^phase: .+$/m, "phase: complete")
    .replace(/^updated: .+$/m, `updated: "${new Date().toISOString()}"`);
  writeFileSync(filePath, updated, "utf-8");
  ok({ completed: true, slug });
}

// ── command tree ──────────────────────────────────────────────────

function joined(words: string[]): string {
  return words.join(" ");
}

function nameLeaf(summary: string, act: (name: string) => undefined): Leaf {
  return leaf({ summary, args: "<name>", run: ({ positionals }) => act(positionals[0]) });
}

function statusLeaf(summary: string, status: ProjectStatus): Leaf {
  return nameLeaf(summary, (name) => setStatus(name, status));
}

function iscLeaf(summary: string, act: (name: string, id: number) => undefined): Leaf {
  return leaf({
    summary,
    args: "<name> <id>",
    run: ({ positionals }) => act(positionals[0], positiveId(positionals[1], "<id>")),
  });
}

function textLeaf(
  summary: string,
  slot: string,
  act: (name: string, text: string) => undefined
): Leaf {
  return leaf({
    summary,
    args: `<name> ${slot}`,
    run: ({ positionals }) => act(positionals[0], joined(positionals.slice(1))),
  });
}

function removeLeaf(summary: string, field: "next" | "blockers"): Leaf {
  return leaf({
    summary,
    args: "<name> <index>",
    run: ({ positionals }) =>
      removeItem(positionals[0], field, listIndex(positionals[1])),
  });
}

export const command = group({
  summary: "Manage PAL project state (ISA.md backed)",
  commands: {
    list: leaf({ summary: "Show all registered projects", run: cmdList }),
    create: leaf({
      summary: "Register a project",
      args: "[name]",
      options: {
        path: {
          type: "string",
          value: "<path>",
          description: "Where the project lives (default: cwd)",
        },
        name: {
          type: "string",
          value: "<name>",
          description: "Slug, instead of [name] (default: the path's basename)",
        },
        objectives: {
          type: "string",
          value: "<a;b>",
          description: "Goal lines, split on ';', '|' or newlines",
        },
        serves: {
          type: "string",
          value: `<${SERVES_KINDS.join("|")}>`,
          description: "What the project is for",
        },
        "serves-note": {
          type: "string",
          value: "<text>",
          description: "Why, in a few words",
        },
      },
      run: ({ positionals, values }) =>
        cmdCreate(projectName(positionals[0], values.name), values),
    }),
    serves: leaf({
      summary: "Say what it is for — outranks PAL's guess",
      args: `<name> <${SERVES_KINDS.join("|")}> [note...]`,
      run: ({ positionals: [name, kind, ...note] }) =>
        cmdServes(name, servesKind(kind, "serves"), joined(note)),
    }),
    resume: nameLeaf(
      "Print lean project view (open-ISC titles; full text via show-isc)",
      cmdResume
    ),
    complete: statusLeaf("Mark complete", "complete"),
    archive: statusLeaf("Mark archived", "archived"),
    pause: statusLeaf("Mark paused", "paused"),
    unpause: statusLeaf("Mark active again", "active"),
    "set-path": leaf({
      summary: "Update the registered path",
      args: "<name> <path...>",
      run: ({ positionals: [name, ...path] }) => cmdSetPath(name, joined(path)),
    }),
    "add-next": textLeaf("Append next step", "<text...>", (name, text) =>
      appendItem(name, "next", text)
    ),
    "add-blocker": textLeaf("Append blocker", "<text...>", (name, text) =>
      appendItem(name, "blockers", text)
    ),
    "add-decision": leaf({
      summary: "Log a dated decision entry",
      args: "<name> <decision> <rationale...>",
      run: ({ positionals: [name, decision, ...rationale] }) =>
        addDecision(name, decision, joined(rationale)),
    }),
    "add-handoff": textLeaf("Overwrite handoff field", "<text...>", addHandoff),
    "rm-next": removeLeaf("Remove next step by index", "next"),
    "rm-blocker": removeLeaf("Remove blocker by index", "blockers"),
    "update-section": leaf({
      summary: "Set an ISA body section",
      args: "<name> <section> <content...>",
      details: `Sections: ${VALID_SECTIONS.join(", ")}`,
      run: ({ positionals: [name, section, ...content] }) =>
        cmdUpdateSection(name, section, joined(content)),
    }),
    criteria: nameLeaf("Print the Criteria section", cmdCriteria),
    "add-isc": textLeaf("Append a new open ISC to Criteria", "<title...>", cmdAddIsc),
    "complete-isc": iscLeaf("Mark ISC-N as done", cmdCompleteIsc),
    "reopen-isc": iscLeaf("Reopen ISC-N (mark not done)", cmdReopenIsc),
    "list-isc": leaf({
      summary: "List open ISCs (default), or the closed or retired ones",
      args: "<name>",
      options: {
        all: { type: "boolean", description: "Open, done and retired" },
        closed: { type: "boolean", description: "Done only" },
        retired: { type: "boolean", description: "Retired only" },
      },
      run: ({ positionals, values }) => cmdListIsc(positionals[0], iscListFlag(values)),
    }),
    "show-isc": iscLeaf("Print one ISC's full text", cmdShowIsc),
    "edit-isc": leaf({
      summary: "Rewrite ISC-N's text, keeping its id and state",
      args: "<name> <id> <text...>",
      run: ({ positionals: [name, id, ...text] }) =>
        cmdEditIsc(name, positiveId(id, "<id>"), joined(text)),
    }),
    "retire-isc": leaf({
      summary: "Close ISC-N as no longer valid, not as done",
      args: "<name> <id>",
      options: {
        by: { type: "string", value: "<id>", description: "The ISC that supersedes it" },
      },
      run: ({ positionals: [name, id], values }) =>
        cmdRetireIsc(
          name,
          positiveId(id, "<id>"),
          values.by === undefined ? null : positiveId(values.by, "--by")
        ),
    }),
    "prune-isc": nameLeaf(
      "Archive done ISCs from Criteria into the Changelog",
      cmdPruneIsc
    ),
    "isa-init": nameLeaf("Mark project as ISA-initialized", cmdIsaInit),
    "scaffold-task-isa": leaf({
      summary: "Create a one-shot task ISA in memory/work/",
      args: "<title...>",
      run: ({ positionals }) => cmdScaffoldTaskIsa(joined(positionals)),
    }),
    "complete-task-isa": leaf({
      summary: "Mark a task ISA as complete",
      args: "<slug>",
      run: ({ positionals }) => cmdCompleteTaskIsa(positionals[0]),
    }),
    migrate: leaf({
      summary: "Migrate old JSON progress files → ISA.md",
      run: cmdMigrate,
    }),
    rm: nameLeaf("Delete the entire project", cmdRm),
  },
});

export function run(argv: string[] = scriptArgs()): Promise<number> {
  return runCommand(command, argv, ["pal", "cli", "project"]);
}

if (import.meta.main) process.exit(await run());

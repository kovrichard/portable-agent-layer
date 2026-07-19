#!/usr/bin/env bun
/**
 * Project — register and manage user projects via ISA.md files.
 *
 * Each project is stored at `~/.pal/memory/projects/{slug}/ISA.md`.
 * Frontmatter holds operational state; body holds ISA spec sections.
 *
 * Usage:
 *   bun ~/.pal/tools/project.ts list
 *   bun ~/.pal/tools/project.ts create [name] [--path PATH] [--objectives "..."]
 *   bun ~/.pal/tools/project.ts resume <name>
 *   bun ~/.pal/tools/project.ts complete | archive | pause | unpause <name>
 *   bun ~/.pal/tools/project.ts add-next <name> "text"
 *   bun ~/.pal/tools/project.ts add-blocker <name> "text"
 *   bun ~/.pal/tools/project.ts add-decision <name> "decision" "rationale"
 *   bun ~/.pal/tools/project.ts add-handoff <name> "text"
 *   bun ~/.pal/tools/project.ts rm-next | rm-blocker <name> <index>
 *   bun ~/.pal/tools/project.ts update-section <name> <section> "content"
 *   bun ~/.pal/tools/project.ts criteria <name>
 *   bun ~/.pal/tools/project.ts isa-init <name>
 *   bun ~/.pal/tools/project.ts migrate
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { paths } from "../../hooks/lib/paths";
import {
  defaultSlug,
  deleteProject,
  isStale,
  legacyJsonToProgress,
  type ProjectProgress,
  type ProjectStatus,
  readAllProjects,
  readProject,
  writeProject,
} from "../../hooks/lib/projects";

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

// ── list ──────────────────────────────────────────────────────────

function cmdList(): void {
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

function cmdCreate(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      path: { type: "string" },
      name: { type: "string" },
      objectives: { type: "string" },
    },
    allowPositionals: true,
  });

  const path = resolve(values.path ?? process.cwd());
  const name = (values.name ?? positionals[0] ?? defaultSlug(path)).trim();

  if (!/^[a-z0-9_-]+$/.test(name)) {
    fail(
      `Invalid project name "${name}". Use lowercase letters, digits, hyphens, underscores.`
    );
  }

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
  };
  writeProject(project);
  ok({ created: true, project });
}

// ── resume ────────────────────────────────────────────────────────

function cmdResume(args: string[]): void {
  const name = args[0];
  if (!name) fail("Usage: resume <name>");
  ok({ project: requireProject(name) });
}

// ── status transitions ────────────────────────────────────────────

function setStatus(name: string, status: ProjectStatus): void {
  const p = requireProject(name);
  p.status = status;
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name, status });
}

// ── append/remove for array fields ───────────────────────────────

function appendItem(name: string, field: "next" | "blockers", text: string): void {
  if (!text?.trim()) fail(`Empty ${field} text.`);
  const p = requireProject(name);
  const list = p[field] ?? [];
  list.push(text.trim());
  p[field] = list;
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name, field, count: list.length });
}

function removeItem(name: string, field: "next" | "blockers", indexArg: string): void {
  const idx = parseInt(indexArg, 10);
  if (!Number.isInteger(idx) || idx < 0) fail(`Invalid index "${indexArg}".`);
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

function addDecision(name: string, decision: string, rationale: string): void {
  if (!decision?.trim() || !rationale?.trim())
    fail("Usage: add-decision <name> <decision> <rationale>");
  const p = requireProject(name);
  const date = new Date().toISOString().slice(0, 10);
  const line = `- ${date}: ${decision.trim()} (${rationale.trim()})`;
  p.decisions = p.decisions ? `${p.decisions}\n${line}` : line;
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name });
}

// ── handoff ───────────────────────────────────────────────────────

function addHandoff(name: string, text: string): void {
  if (!text?.trim()) fail("Empty handoff text.");
  const p = requireProject(name);
  p.handoff = text.trim();
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name });
}

// ── set-path ──────────────────────────────────────────────────────

function cmdSetPath(args: string[]): void {
  const [name, ...rest] = args;
  if (!name || rest.length === 0) fail("Usage: set-path <name> <new-path>");
  const newPath = resolve(rest.join(" ").trim());
  const p = requireProject(name);
  p.path = newPath;
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

function cmdUpdateSection(args: string[]): void {
  const [name, section, ...rest] = args;
  if (!name || !section) fail("Usage: update-section <name> <section> <content>");
  const key = section.toLowerCase().replace(/\s+/g, "_") as Section;
  if (!(VALID_SECTIONS as readonly string[]).includes(key)) {
    fail(`Unknown section "${section}". Valid: ${VALID_SECTIONS.join(", ")}`);
  }
  const content = rest.join(" ").trim();
  if (!content) fail("Empty content.");
  const p = requireProject(name);
  (p as unknown as Record<string, unknown>)[key] = content;
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name, section: key });
}

// ── criteria ──────────────────────────────────────────────────────

function cmdCriteria(args: string[]): void {
  const name = args[0];
  if (!name) fail("Usage: criteria <name>");
  const p = requireProject(name);
  ok({ name, criteria: p.criteria ?? "" });
}

// ── isa-init ──────────────────────────────────────────────────────

function cmdIsaInit(args: string[]): void {
  const name = args[0];
  if (!name) fail("Usage: isa-init <name>");
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

function cmdMigrate(): void {
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

function cmdRm(args: string[]): void {
  const name = args[0];
  if (!name) fail("Usage: rm <name>  (deletes the entire project directory)");
  const removed = deleteProject(name);
  if (!removed) fail(`No project named "${name}".`);
  ok({ deleted: true, name });
}

// ── ISC helpers ──────────────────────────────────────────────────

interface Isc {
  id: number;
  text: string;
  checked: boolean;
}

function parseIscs(criteria: string): Isc[] {
  const out: Isc[] = [];
  for (const line of criteria.split("\n")) {
    const m = new RegExp(/^-\s+\[( |x)\]\s+ISC-(\d+):\s+(.+)$/i).exec(line);
    if (m) out.push({ id: Number(m[2]), text: m[3].trim(), checked: m[1] === "x" });
  }
  return out;
}

// Scans Criteria AND Changelog so an archived id can never be handed out again.
function nextIscId(p: ProjectProgress): number {
  const ids = [...parseIscs(p.criteria ?? ""), ...parseIscs(p.changelog ?? "")].map(
    (i) => i.id
  );
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

function removeIscLine(
  section: string,
  id: number
): { line: string | null; rest: string } {
  const lines = section.split("\n");
  const idx = lines.findIndex((l) =>
    new RegExp(String.raw`^-\s+\[[ x]\]\s+ISC-${id}:`).test(l)
  );
  if (idx === -1) return { line: null, rest: section };
  const [line] = lines.splice(idx, 1);
  return {
    line,
    rest: lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

// Drops any "### Archived <date>" heading whose block has no content left —
// e.g. after every ISC filed under that date has been reopened.
function dropEmptyArchiveHeadings(changelog: string): string {
  const lines = changelog.split("\n");
  const blockHasContent = (headingIdx: number): boolean => {
    for (let j = headingIdx + 1; j < lines.length && !lines[j].startsWith("### "); j++) {
      if (lines[j].trim() !== "") return true;
    }
    return false;
  };
  return lines
    .filter((l, i) => !(/^### Archived /.test(l) && !blockHasContent(i)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function archiveLine(changelog: string | undefined, doneLine: string): string {
  const heading = `### Archived ${new Date().toISOString().slice(0, 10)}`;
  const base = (changelog ?? "").trim();
  if (base.includes(heading)) return `${base}\n${doneLine}`;
  return base ? `${base}\n\n${heading}\n${doneLine}` : `${heading}\n${doneLine}`;
}

function cmdAddIsc(args: string[]): void {
  const name = args[0] ?? fail("Usage: add-isc <name> <title>");
  const title = args.slice(1).join(" ").trim();
  if (!title) fail("Usage: add-isc <name> <title>");
  const p = requireProject(name);
  const current = p.criteria ?? "";
  const id = nextIscId(p);
  const newLine = `- [ ] ISC-${id}: ${title}`;
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
function cmdCompleteIsc(args: string[]): void {
  const name = args[0] ?? fail("Usage: complete-isc <name> <id>");
  const id = Number(args[1] ?? fail("Usage: complete-isc <name> <id>"));
  if (!Number.isInteger(id) || id < 1) fail("ISC id must be a positive integer");
  const p = requireProject(name);
  if (parseIscs(p.changelog ?? "").some((i) => i.id === id)) {
    ok({ checked: true, id, alreadyDone: true });
    return;
  }
  const { line, rest } = removeIscLine(p.criteria ?? "", id);
  if (!line) fail(`ISC-${id} not found in project "${name}"`);
  p.criteria = rest;
  p.changelog = archiveLine(p.changelog, line.replace("[ ]", "[x]"));
  p.updated = now();
  writeProject(p);
  ok({ checked: true, id, archived: true });
}

// Reopening pulls the line back out of the Changelog (or legacy Criteria) into
// the open set.
function cmdReopenIsc(args: string[]): void {
  const name = args[0] ?? fail("Usage: reopen-isc <name> <id>");
  const id = Number(args[1] ?? fail("Usage: reopen-isc <name> <id>"));
  if (!Number.isInteger(id) || id < 1) fail("ISC id must be a positive integer");
  const p = requireProject(name);
  if (parseIscs(p.criteria ?? "").some((i) => i.id === id && !i.checked)) {
    ok({ checked: false, id, alreadyOpen: true });
    return;
  }
  let removed = removeIscLine(p.changelog ?? "", id);
  if (removed.line) {
    p.changelog = dropEmptyArchiveHeadings(removed.rest);
  } else {
    removed = removeIscLine(p.criteria ?? "", id);
    if (removed.line) p.criteria = removed.rest;
  }
  if (!removed.line) fail(`ISC-${id} not found in project "${name}"`);
  const openLine = removed.line.replace(/\[x\]/i, "[ ]");
  p.criteria = p.criteria ? `${p.criteria.trimEnd()}\n${openLine}` : openLine;
  p.updated = now();
  writeProject(p);
  ok({ checked: false, id });
}

function selectIscs(open: Isc[], done: Isc[], flags: Set<string>): Isc[] {
  if (flags.has("--all")) return [...open, ...done];
  if (flags.has("--closed")) return done;
  return open;
}

function cmdListIsc(args: string[]): void {
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const name =
    args.find((a) => !a.startsWith("--")) ??
    fail("Usage: list-isc <name> [--all | --closed]");
  const p = requireProject(name);
  const criteria = parseIscs(p.criteria ?? "");
  const open = criteria.filter((i) => !i.checked);
  const done = [...criteria.filter((i) => i.checked), ...parseIscs(p.changelog ?? "")];
  ok({
    name,
    total: open.length + done.length,
    open: open.length,
    done: done.length,
    iscs: selectIscs(open, done, flags),
  });
}

// Backfill: sweep any done ISCs still sitting in Criteria (legacy projects, or
// completions from before archive-on-complete) into the Changelog in one pass.
function cmdPruneIsc(args: string[]): void {
  const name = args[0] ?? fail("Usage: prune-isc <name>");
  const p = requireProject(name);
  const done = parseIscs(p.criteria ?? "").filter((i) => i.checked);
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
  const openLeft = parseIscs(p.criteria ?? "").filter((i) => !i.checked).length;
  ok({ pruned: done.length, name, remaining_open: openLeft });
}

// ── Task ISA (work/) ──────────────────────────────────────────────

function taskSlug(title: string): string {
  const sanitized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${sanitized}-${Date.now().toString(36)}`;
}

function taskIsaPath(slug: string): string {
  const dir = resolve(paths.work(), slug);
  mkdirSync(dir, { recursive: true });
  return resolve(dir, "ISA.md");
}

function cmdScaffoldTaskIsa(args: string[]): void {
  const title = args.join(" ").trim();
  if (!title) fail("Usage: scaffold-task-isa <title>");
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

function cmdCompleteTaskIsa(args: string[]): void {
  const slug = args[0] ?? fail("Usage: complete-task-isa <slug>");
  const filePath = resolve(paths.work(), slug, "ISA.md");
  if (!existsSync(filePath)) fail(`Task ISA not found: ${slug}`);
  const content = readFileSync(filePath, "utf-8");
  const updated = content
    .replace(/^phase: .+$/m, "phase: complete")
    .replace(/^updated: .+$/m, `updated: "${new Date().toISOString()}"`);
  writeFileSync(filePath, updated, "utf-8");
  ok({ completed: true, slug });
}

// ── dispatch ──────────────────────────────────────────────────────

function help(): void {
  console.log(`Project — manage PAL project state (ISA.md backed).

Commands:
  list                                          show all registered projects
  create [name] [--path PATH] [--objectives X]  register a project
  resume <name>                                 print full project ISA
  complete <name>                               mark complete
  archive <name>                                mark archived
  pause <name> | unpause <name>                 toggle paused/active
  set-path <name> <new-path>                    update the registered path
  add-next <name> "text"                        append next step
  add-blocker <name> "text"                     append blocker
  add-decision <name> "decision" "rationale"    log a dated decision entry
  add-handoff <name> "text"                     overwrite handoff field
  rm-next <name> <index>                        remove next step by index
  rm-blocker <name> <index>                     remove blocker by index
  update-section <name> <section> "content"     set an ISA body section
  criteria <name>                               print the Criteria section
  add-isc <name> "title"                        append a new open ISC to Criteria
  complete-isc <name> <id>                      mark ISC-N as done
  reopen-isc <name> <id>                        reopen ISC-N (mark not done)
  list-isc <name> [--all | --closed]           list open ISCs (default); --all or --closed for done
  prune-isc <name>                              archive done ISCs from Criteria into the Changelog
  isa-init <name>                               mark project as ISA-initialized
  scaffold-task-isa <title>                     create a one-shot task ISA in memory/work/
  complete-task-isa <slug>                      mark a task ISA as complete
  migrate                                       migrate old JSON progress files → ISA.md
  rm <name>                                     delete the entire project
`);
}

function run(): void {
  const [cmd, ...rest] = Bun.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    help();
    return;
  }
  switch (cmd) {
    case "list":
      cmdList();
      return;
    case "create":
      cmdCreate(rest);
      return;
    case "resume":
      cmdResume(rest);
      return;
    case "complete":
      setStatus(rest[0] ?? fail("Usage: complete <name>"), "complete");
      return;
    case "archive":
      setStatus(rest[0] ?? fail("Usage: archive <name>"), "archived");
      return;
    case "pause":
      setStatus(rest[0] ?? fail("Usage: pause <name>"), "paused");
      return;
    case "unpause":
      setStatus(rest[0] ?? fail("Usage: unpause <name>"), "active");
      return;
    case "add-next":
      appendItem(
        rest[0] ?? fail("Usage: add-next <name> <text>"),
        "next",
        rest.slice(1).join(" ")
      );
      return;
    case "add-blocker":
      appendItem(
        rest[0] ?? fail("Usage: add-blocker <name> <text>"),
        "blockers",
        rest.slice(1).join(" ")
      );
      return;
    case "add-decision":
      addDecision(
        rest[0] ?? fail("Usage: add-decision <name> <decision> <rationale>"),
        rest[1] ?? "",
        rest.slice(2).join(" ")
      );
      return;
    case "add-handoff":
      addHandoff(
        rest[0] ?? fail("Usage: add-handoff <name> <text>"),
        rest.slice(1).join(" ")
      );
      return;
    case "rm-next":
      removeItem(rest[0] ?? fail("Usage: rm-next <name> <index>"), "next", rest[1] ?? "");
      return;
    case "rm-blocker":
      removeItem(
        rest[0] ?? fail("Usage: rm-blocker <name> <index>"),
        "blockers",
        rest[1] ?? ""
      );
      return;
    case "update-section":
      cmdUpdateSection(rest);
      return;
    case "criteria":
      cmdCriteria(rest);
      return;
    case "add-isc":
      cmdAddIsc(rest);
      return;
    case "complete-isc":
      cmdCompleteIsc(rest);
      return;
    case "reopen-isc":
      cmdReopenIsc(rest);
      return;
    case "list-isc":
      cmdListIsc(rest);
      return;
    case "prune-isc":
      cmdPruneIsc(rest);
      return;
    case "isa-init":
      cmdIsaInit(rest);
      return;
    case "scaffold-task-isa":
      cmdScaffoldTaskIsa(rest);
      return;
    case "complete-task-isa":
      cmdCompleteTaskIsa(rest);
      return;
    case "migrate":
      cmdMigrate();
      return;
    case "set-path":
      cmdSetPath(rest);
      return;
    case "rm":
      cmdRm(rest);
      return;
    default:
      fail(`Unknown command "${cmd}". Run 'project.ts help' for usage.`);
  }
}

if (import.meta.main) run();

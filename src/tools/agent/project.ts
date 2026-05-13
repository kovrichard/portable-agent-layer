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

import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { paths } from "../../hooks/lib/paths";
import {
  defaultSlug,
  deleteProject,
  isStale,
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
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as LegacyProject;
      if (!raw?.name || !raw?.path || !raw?.status) {
        skipped++;
        results.push(`${slug}: skipped (malformed JSON)`);
        continue;
      }

      const p: ProjectProgress = {
        name: raw.name,
        path: raw.path,
        status: raw.status,
        created: raw.created,
        updated: raw.updated,
        ...(raw.handoff ? { handoff: raw.handoff } : {}),
        ...(raw.next_steps?.length ? { next: raw.next_steps } : {}),
        ...(raw.blockers?.length ? { blockers: raw.blockers } : {}),
      };

      if (raw.facts?.length) p.context = raw.facts.join("\n");
      if (raw.objectives?.length) p.goal = raw.objectives.map((o) => `- ${o}`).join("\n");
      if (raw.decisions?.length) {
        p.decisions = raw.decisions
          .map((d) => `- ${d.ts.slice(0, 10)}: ${d.decision} (${d.rationale})`)
          .join("\n");
      }

      writeProject(p);
      unlinkSync(filePath);
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
  isa-init <name>                               mark project as ISA-initialized
  migrate                                       migrate old JSON progress files → ISA.md
  rm <name>                                     delete the entire project
`);
}

export function run(): void {
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
    case "isa-init":
      cmdIsaInit(rest);
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

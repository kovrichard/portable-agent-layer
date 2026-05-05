#!/usr/bin/env bun
/**
 * Project — register and manage user projects via per-project progress JSONs.
 *
 * Replaces the hand-edited `~/.pal/telos/PROJECTS.md`. The AI is the primary
 * caller (proactive registration on unregistered cwds, append-as-you-go updates);
 * the user is the escape hatch for fine-grained control.
 *
 * State: `~/.pal/memory/state/progress/{slug}.json`. Auto-touched on Stop hook
 * when cwd resolves into a registered project.
 *
 * Usage:
 *   bun ~/.pal/tools/project.ts list
 *   bun ~/.pal/tools/project.ts create [name] [--path PATH] [--objectives "..."]
 *   bun ~/.pal/tools/project.ts resume <name>
 *   bun ~/.pal/tools/project.ts complete | archive | pause | unpause <name>
 *   bun ~/.pal/tools/project.ts add-fact <name> "text"
 *   bun ~/.pal/tools/project.ts add-objective <name> "text"
 *   bun ~/.pal/tools/project.ts add-next <name> "text"
 *   bun ~/.pal/tools/project.ts add-blocker <name> "text"
 *   bun ~/.pal/tools/project.ts add-decision <name> "decision" "rationale"
 *   bun ~/.pal/tools/project.ts add-handoff <name> "text"
 *   bun ~/.pal/tools/project.ts rm-fact | rm-objective | rm-next | rm-blocker <name> <index>
 */

import { resolve } from "node:path";
import { parseArgs } from "node:util";
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
    objectives: p.objectives?.length ?? 0,
    next_steps: p.next_steps?.length ?? 0,
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

  const objectives = values.objectives
    ? values.objectives
        .split(/[\n;|]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const project: ProjectProgress = {
    name,
    path,
    status: "active",
    created: now(),
    updated: now(),
    objectives,
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

// ── append helpers ────────────────────────────────────────────────

function appendItem(
  name: string,
  field: "facts" | "objectives" | "next_steps" | "blockers",
  text: string
): void {
  if (!text?.trim()) fail(`Empty ${field.replace("_", " ")} text.`);
  const p = requireProject(name);
  const list = p[field] ?? [];
  list.push(text.trim());
  p[field] = list;
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name, field, count: list.length });
}

function removeItem(
  name: string,
  field: "facts" | "objectives" | "next_steps" | "blockers",
  indexArg: string
): void {
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

function addDecision(name: string, decision: string, rationale: string): void {
  if (!decision?.trim() || !rationale?.trim())
    fail("Usage: add-decision <name> <decision> <rationale>");
  const p = requireProject(name);
  const list = p.decisions ?? [];
  list.push({ ts: now(), decision: decision.trim(), rationale: rationale.trim() });
  p.decisions = list;
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name, count: list.length });
}

function addHandoff(name: string, text: string): void {
  if (!text?.trim()) fail("Empty handoff text.");
  const p = requireProject(name);
  p.handoff = text.trim();
  p.updated = now();
  writeProject(p);
  ok({ updated: true, name });
}

// ── rm (project) ──────────────────────────────────────────────────

function cmdRm(args: string[]): void {
  const name = args[0];
  if (!name) fail("Usage: rm <name>  (deletes the entire project state file)");
  const removed = deleteProject(name);
  if (!removed) fail(`No project named "${name}".`);
  ok({ deleted: true, name });
}

// ── dispatch ──────────────────────────────────────────────────────

function help(): void {
  console.log(`Project — manage PAL project state.

Commands:
  list                                          show all registered projects
  create [name] [--path PATH] [--objectives X]  register a project (defaults: name=basename(cwd), path=cwd)
  resume <name>                                 print full project JSON
  complete <name>                               mark complete
  archive <name>                                mark archived
  pause <name> | unpause <name>                 toggle paused/active
  add-fact <name> "text"                        append a stable fact / reference
  add-objective <name> "text"                   append objective
  add-next <name> "text"                        append next step
  add-blocker <name> "text"                     append blocker
  add-decision <name> "decision" "rationale"    log a decision
  add-handoff <name> "text"                     overwrite handoff field
  rm-fact <name> <index>                        remove fact by index
  rm-objective <name> <index>                   remove objective by index
  rm-next <name> <index>                        remove next step by index
  rm-blocker <name> <index>                     remove blocker by index
  rm <name>                                     delete the entire project file
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
    case "add-fact":
      appendItem(
        rest[0] ?? fail("Usage: add-fact <name> <text>"),
        "facts",
        rest.slice(1).join(" ")
      );
      return;
    case "add-objective":
      appendItem(
        rest[0] ?? fail("Usage: add-objective <name> <text>"),
        "objectives",
        rest.slice(1).join(" ")
      );
      return;
    case "add-next":
      appendItem(
        rest[0] ?? fail("Usage: add-next <name> <text>"),
        "next_steps",
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
    case "rm-fact":
      removeItem(
        rest[0] ?? fail("Usage: rm-fact <name> <index>"),
        "facts",
        rest[1] ?? ""
      );
      return;
    case "rm-objective":
      removeItem(
        rest[0] ?? fail("Usage: rm-objective <name> <index>"),
        "objectives",
        rest[1] ?? ""
      );
      return;
    case "rm-next":
      removeItem(
        rest[0] ?? fail("Usage: rm-next <name> <index>"),
        "next_steps",
        rest[1] ?? ""
      );
      return;
    case "rm-blocker":
      removeItem(
        rest[0] ?? fail("Usage: rm-blocker <name> <index>"),
        "blockers",
        rest[1] ?? ""
      );
      return;
    case "rm":
      cmdRm(rest);
      return;
    default:
      fail(`Unknown command "${cmd}". Run 'project.ts help' for usage.`);
  }
}

if (import.meta.main) run();

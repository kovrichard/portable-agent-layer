#!/usr/bin/env bun
/**
 * Project — register and manage user projects via ISA.md files.
 *
 * Each project is stored at `~/.pal/memory/projects/{slug}/ISA.md`.
 * Frontmatter holds operational state; body holds ISA spec sections.
 *
 * Usage: pal cli project <command> --help
 */

import { existsSync } from "node:fs";
import { writeBinding } from "../../hooks/lib/bindings";
import { toPath } from "../../hooks/lib/paths";
import {
  defaultSlug,
  deleteProject,
  isStale,
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
import { decisionRow, emitHistoryRow, registrationRow } from "../lib/project-history";
import { iscTitle, parseIscs } from "../lib/project-isc";
import { scriptArgs } from "../lib/script-args";
import { fail, joined, nonBlank, now, ok, requireProject } from "./project-io";
import { iscCommands } from "./project-isc-commands";
import { cmdMigrate } from "./project-migrate";
import { taskIsaCommands } from "./project-task-isa";

// ── argument values ───────────────────────────────────────────────

function listIndex(value: string): number {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0) {
    throw new UsageError(`<index> must be a non-negative integer, got "${value}"`);
  }

  return index;
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
  emitHistoryRow(registrationRow(project));
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

// Criteria and Changelog collapse to open-ISC titles and counts; show-isc and list-isc
// give the full text, so resume stays cheap on a large backlog.
function cmdResume(name: string): undefined {
  const { criteria, changelog, ...project } = requireProject(name);
  const iscs = parseIscs(criteria ?? "");
  const archived = parseIscs(changelog ?? "");
  const openIscs = iscs.filter((i) => i.status === "open");
  const all = [...iscs, ...archived];
  const done = all.filter((i) => i.status === "done").length;
  const retired = all.filter((i) => i.status === "retired").length;
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
  const ts = now();
  const date = ts.slice(0, 10);
  const line = `- ${date}: ${what} (${why})`;
  p.decisions = p.decisions ? `${p.decisions}\n${line}` : line;
  p.updated = ts;
  writeProject(p);
  emitHistoryRow({ ...decisionRow(name, date, `${what} (${why})`), ts });
  ok({ updated: true, name });
}

// ── set-path ──────────────────────────────────────────────────────

// Unlike saving a record, the directory need not exist yet: naming where a repo is
// about to be cloned is a legitimate use.
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

// ── rm (project) ──────────────────────────────────────────────────

function cmdRm(name: string): undefined {
  const removed = deleteProject(name);
  if (!removed) fail(`No project named "${name}".`);
  ok({ deleted: true, name });
}

// ── command tree ──────────────────────────────────────────────────

function nameLeaf(summary: string, act: (name: string) => undefined): Leaf {
  return leaf({ summary, args: "<name>", run: ({ positionals }) => act(positionals[0]) });
}

function statusLeaf(summary: string, status: ProjectStatus): Leaf {
  return nameLeaf(summary, (name) => setStatus(name, status));
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
    ...iscCommands,
    "isa-init": nameLeaf("Mark project as ISA-initialized", cmdIsaInit),
    ...taskIsaCommands,
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

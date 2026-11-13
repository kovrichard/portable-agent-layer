import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendEvent,
  isMain,
  printJson,
  readTask,
  spawnTool,
  taskDir,
  writeTask,
} from "./lib.mjs";

export function run(command, args, cwd, env, input) {
  const result = spawnTool(command, args, { cwd, env, input });

  return {
    ok: result.status === 0,
    out: (result.stdout ?? "").trim(),
    err: (result.stderr ?? "").trim(),
  };
}

export function must(command, args, cwd, env, input) {
  const result = run(command, args, cwd, env, input);
  if (!result.ok) throw new Error(`${command} ${args.join(" ")} failed: ${result.err}`);

  return result.out;
}

function specSections(spec) {
  const [lead, ...rest] = spec.trim().split(/^## /m);
  const sections = new Map(
    rest.map((chunk) => {
      const [heading, ...body] = chunk.split("\n");

      return [heading.trim(), body.join("\n").trim()];
    })
  );

  return { lead: lead.replace(/^# .*\n?/, "").trim(), sections };
}

const HEADLINE_MAX = 140;

function capped(text) {
  return text.length > HEADLINE_MAX ? `${text.slice(0, HEADLINE_MAX - 1)}…` : text;
}

function headlineOf(item) {
  const bold = new RegExp(/^\*\*(.+?)\*\*(?![`\w*])/).exec(item);
  if (bold) return bold[1];

  return item.split(/\s+Reason:|(?<=[.)]):\s|\.\s/)[0].replace(/\.$/, "");
}

function decisionHeadlines(decisions) {
  return Array.from(
    decisions.matchAll(/^(\d+\.|[-*])\s+(.+)$/gm),
    ([, marker, item]) => `${marker} ${capped(headlineOf(item))}`
  ).join("\n");
}

function firstParagraph(text) {
  return text.split(/\n\s*\n/)[0].trim();
}

function prSections({ lead, sections }) {
  const goal = sections.get("Goal");
  const decisions = decisionHeadlines(sections.get("Decisions") ?? "");
  const weakest = sections.get("Weakest assumption");

  return [
    lead,
    goal && `## Goal\n\n${goal}`,
    decisions && `## Decisions\n\n${decisions}`,
    weakest && `## Weakest assumption\n\n${firstParagraph(weakest)}`,
  ].filter(Boolean);
}

export function prBody(spec, footer = "Opened by dark-factory.") {
  const parts = prSections(specSections(spec));
  const body = parts.length > 1 ? parts.join("\n\n") : spec.trim();

  return `${body}\n\n---\nThe full spec, with acceptance criteria and each decision's reasoning, is in the task folder.\n${footer}\n`;
}

export function push(id, env = process.env) {
  const task = readTask(id, env);
  must(
    "git",
    ["push", "--force-with-lease", "-u", "origin", task.branch],
    task.worktree,
    env
  );
  const head = must("git", ["rev-parse", "HEAD"], task.worktree, env);
  appendEvent({ event: "pushed", task: id, head }, env);

  return { pushed: task.branch };
}

function parsePrList(text) {
  try {
    const list = JSON.parse(text || "[]");

    return Array.isArray(list) ? list : [];
  } catch {
    throw new Error(`gh pr list printed no JSON: ${text.slice(0, 200)}`);
  }
}

function existingPr(task, env) {
  const out = must(
    "gh",
    ["pr", "list", "--head", task.branch, "--state", "open", "--json", "url"],
    task.worktree,
    env
  );

  return parsePrList(out)[0]?.url ?? null;
}

function adoptPr(task, url, env) {
  writeTask({ ...task, pr: url }, env);
  appendEvent({ event: "pr_adopted", task: task.id, pr: url }, env);

  return { pr: url, adopted: true };
}

export function openPr(id, env = process.env) {
  const task = readTask(id, env);
  if (task.pr) return { pr: task.pr };
  const adopted = existingPr(task, env);
  if (adopted) return adoptPr(task, adopted, env);
  const spec = readFileSync(join(taskDir(id, env), "spec.md"), "utf8");
  const url = must(
    "gh",
    [
      "pr",
      "create",
      "--draft",
      "--base",
      task.base,
      "--head",
      task.branch,
      "--title",
      task.title,
      "--body-file",
      "-",
    ],
    task.worktree,
    env,
    prBody(spec)
  );
  writeTask({ ...task, pr: url }, env);
  appendEvent({ event: "pr_opened", task: id, pr: url }, env);

  return { pr: url };
}

function unmergedFiles(cwd, env) {
  return run("git", ["diff", "--name-only", "--diff-filter=U"], cwd, env)
    .out.split("\n")
    .filter(Boolean);
}

function rebaseFailed(id, task, rebase, env) {
  const files = unmergedFiles(task.worktree, env);
  run("git", ["rebase", "--abort"], task.worktree, env);

  if (files.length === 0) throw new Error(`git rebase failed: ${rebase.err}`);
  appendEvent({ event: "sync", task: id, result: "conflict", files }, env);

  return { rebased: false, conflict: true, files };
}

export function sync(id, env = process.env) {
  const task = readTask(id, env);
  must("git", ["fetch", "origin", task.base], task.worktree, env);
  const before = must("git", ["rev-parse", "HEAD"], task.worktree, env);
  const rebase = run("git", ["rebase", `origin/${task.base}`], task.worktree, env);
  if (!rebase.ok) return rebaseFailed(id, task, rebase, env);
  const moved = must("git", ["rev-parse", "HEAD"], task.worktree, env) !== before;
  appendEvent({ event: "sync", task: id, result: moved ? "rebased" : "current" }, env);

  return { rebased: moved, conflict: false };
}

export function markReady(id, env = process.env) {
  const task = readTask(id, env);
  must("gh", ["pr", "ready", task.pr], task.worktree, env);
  appendEvent({ event: "pr_ready", task: id, pr: task.pr }, env);

  return { ready: task.pr };
}

const COMMANDS = { push, pr: openPr, sync, ready: markReady };

if (isMain(import.meta.url)) {
  const [command, id] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(
      `usage: ship.mjs ${Object.keys(COMMANDS).join("|")} <task-id>\n`
    );
    process.exit(2);
  }

  try {
    const result = handler(id);
    printJson(result);
    process.exit(result.conflict ? 1 : 0);
  } catch (error) {
    printJson({ error: error.message });
    process.exit(2);
  }
}

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendEvent,
  factoryHome,
  isMain,
  printJson,
  readRepoConfig,
  readTask,
  taskDir,
  writeTask,
} from "./lib.mjs";
import { rolesFor } from "./roles.mjs";

export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function newTask({ title, repo, category }, env = process.env, now = new Date()) {
  rolesFor(category);
  const id = `${now.toISOString().slice(0, 10)}-${slugify(title)}`;
  if (existsSync(taskDir(id, env))) throw new Error(`task ${id} already exists`);
  const task = { id, title, repo, category, status: "draft", created: now.toISOString() };
  writeTask(task, env);
  const specPath = join(taskDir(id, env), "spec.md");
  writeFileSync(specPath, "");
  appendEvent({ event: "task_created", task: id, category }, env, now);
  return { id, specPath };
}

export function setStatus(id, status, note, env = process.env) {
  const task = { ...readTask(id, env), status, ...(note ? { note } : {}) };
  writeTask(task, env);
  appendEvent({ event: "task_status", task: id, status, ...(note ? { note } : {}) }, env);
  return task;
}

export function recordQuestion(id, question, env = process.env, now = new Date()) {
  appendFileSync(
    join(taskDir(id, env), "questions.jsonl"),
    `${JSON.stringify({ ts: now.toISOString(), question })}\n`
  );
  appendEvent({ event: "question_to_user", task: id }, env, now);
  return setStatus(id, "waiting", question, env);
}

export function listTasks(env = process.env) {
  const dir = join(factoryHome(env), "tasks");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((id) => existsSync(join(dir, id, "task.json")))
    .map((id) => readTask(id, env));
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function defaultBranch(repo) {
  return git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repo).replace(
    /^origin\//,
    ""
  );
}

function runPrepareCommand(command, cwd) {
  if (!command) return;
  const result = spawnSync("bash", ["-c", command], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", 2, 2],
  });
  if (result.status !== 0) throw new Error(`prepare command failed: ${command}`);
}

export function prepare(id, env = process.env) {
  const task = readTask(id, env);
  const config = readRepoConfig(task.repo);
  const base = config.baseBranch ?? defaultBranch(task.repo);
  const branch = `factory/${id}`;
  const worktree = join(factoryHome(env), "worktrees", id);
  if (!existsSync(worktree)) {
    git(["fetch", "origin", base], task.repo);
    git(["worktree", "add", "-b", branch, worktree, `origin/${base}`], task.repo);
    runPrepareCommand(config.prepare, worktree);
  }
  writeTask({ ...task, base, branch, worktree, status: "running" }, env);
  appendEvent({ event: "task_started", task: id, category: task.category }, env);
  return {
    worktree,
    branch,
    base,
    category: task.category,
    before: rolesFor(task.category).before,
    taskDir: taskDir(id, env),
    specPath: join(taskDir(id, env), "spec.md"),
  };
}

export function recordTrace(id, encoded, env = process.env) {
  const events = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  for (const event of events) appendEvent({ ...event, task: id }, env);
  return { recorded: events.length };
}

const COMMANDS = {
  trace: ([id, encoded]) => recordTrace(id, encoded),
  new: ([title, repo, category]) => newTask({ title, repo, category }),
  prepare: ([id]) => prepare(id),
  status: ([id, status, note]) => setStatus(id, status, note),
  ask: ([id, question]) => recordQuestion(id, question),
  list: () => listTasks(),
  show: ([id]) => readTask(id),
};

if (isMain(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`usage: task.mjs ${Object.keys(COMMANDS).join("|")} ...\n`);
    process.exit(2);
  }
  printJson(handler(rest));
}

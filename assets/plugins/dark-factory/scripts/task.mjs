import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { recordHandover } from "./handover.mjs";
import { readInstructions, recordMissingImports } from "./instructions.mjs";
import {
  appendEvent,
  factoryHome,
  isMain,
  PLUGIN_ROOT,
  printJson,
  readEvents,
  readRepoConfig,
  readTask,
  requireTools,
  taskDir,
  writeTask,
} from "./lib.mjs";
import { rolesFor } from "./roles.mjs";
import { writeRoleSettings } from "./settings.mjs";

const PO_SKILL = "/dark-factory:build-with-agents";

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

export function recordPoHandover(id, role, reason, prompt, env = process.env, model) {
  readTask(id, env);
  const { file } = recordHandover(
    id,
    { from: "po", to: role, reason, payload: prompt },
    env
  );
  appendEvent({ event: "role_run", task: id, role, model: model || "default" }, env);
  return { file };
}

function wholeNumber(name, value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} must be a whole number, got "${value}"`);
  }
  return number;
}

export function recordReview(id, round, findings, env = process.env) {
  readTask(id, env);
  const event = {
    event: "review",
    task: id,
    round: wholeNumber("round", round),
    findings: wholeNumber("findings", findings),
  };
  appendEvent(event, env);
  return event;
}

export function recordTest(id, unmet, env = process.env) {
  readTask(id, env);
  const event = { event: "test", task: id, unmet: wholeNumber("unmet", unmet) };
  appendEvent(event, env);
  return event;
}

export function listTasks(env = process.env) {
  const dir = join(factoryHome(env), "tasks");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((id) => existsSync(join(dir, id, "task.json")))
    .map((id) => readTask(id, env));
}

function git(args, cwd, env) {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function defaultBranch(repo, env) {
  return git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repo, env).replace(
    /^origin\//,
    ""
  );
}

function runPrepareCommand(command, cwd, env) {
  if (!command) return;
  const result = spawnSync("bash", ["-c", command], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", 2, 2],
  });
  if (result.status !== 0) throw new Error(`prepare command failed: ${command}`);
}

function repoClaudeMdFor(task, config, env) {
  if (config.repoInstructions === false) return null;
  const found = readInstructions(join(task.repo, "CLAUDE.md"), env);
  if (found === null) return null;
  recordMissingImports(task.id, found.missing, env);
  return { path: found.path, text: found.text };
}

export function markStarted(id, env = process.env) {
  const task = readTask(id, env);
  writeTask({ ...task, status: "running" }, env);
  appendEvent({ event: "task_started", task: id, category: task.category }, env);
}

export function prepare(id, env = process.env) {
  requireTools(env);
  const task = readTask(id, env);
  const config = readRepoConfig(task.repo);
  const repoClaudeMd = repoClaudeMdFor(task, config, env);
  const base = config.baseBranch ?? defaultBranch(task.repo, env);
  const branch = `factory/${id}`;
  const worktree = join(factoryHome(env), "worktrees", id);
  if (!existsSync(worktree)) {
    git(["fetch", "origin", base], task.repo, env);
    git(["worktree", "add", "-b", branch, worktree, `origin/${base}`], task.repo, env);
    runPrepareCommand(config.prepare, worktree, env);
  }
  writeTask({ ...task, base, branch, worktree, config, repoClaudeMd }, env);
  if (task.status !== "ready") markStarted(id, env);
  const settingsFile = writeRoleSettings({ ...task, worktree }, env);
  return {
    worktree,
    branch,
    base,
    config,
    category: task.category,
    before: rolesFor(task.category).before,
    taskDir: taskDir(id, env),
    specPath: join(taskDir(id, env), "spec.md"),
    po: poCommand({ id, worktree, settingsFile, pluginDir: PLUGIN_ROOT }),
    poUnattended: poUnattendedCommand({
      id,
      worktree,
      settingsFile,
      pluginDir: PLUGIN_ROOT,
      taskDir: taskDir(id, env),
    }),
  };
}

function shellArg(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `"${value.replace(/\\(?=[\\"$`]|$)|["$`]/g, "\\$&")}"`;
}

const PO_UNATTENDED_TOOLS =
  "Read,Grep,Glob,Bash,Edit,Write,Agent,SendMessage,Skill,TodoWrite";

function poSession({ id, worktree, settingsFile, pluginDir }, headless = [], extra = []) {
  return [
    "cd",
    shellArg(worktree),
    "&&",
    "claude",
    ...headless,
    "--setting-sources",
    "local",
    ...(settingsFile ? ["--settings", shellArg(settingsFile)] : []),
    "--plugin-dir",
    shellArg(pluginDir),
    ...extra,
    shellArg(`${PO_SKILL} ${id}`),
  ].join(" ");
}

export function poCommand(launch) {
  return poSession(launch);
}

export function poUnattendedCommand(launch) {
  return poSession(
    launch,
    ["-p"],
    [
      "--permission-mode",
      "dontAsk",
      "--add-dir",
      shellArg(launch.taskDir),
      "--add-dir",
      shellArg(launch.pluginDir),
      "--allowedTools",
      PO_UNATTENDED_TOOLS,
    ]
  );
}

function oneLine(text) {
  return String(text)
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

export function decisionLine({ role, question, answer }, now = new Date()) {
  return `- ${now.toISOString().slice(0, 10)}: the ${role} asked "${oneLine(question)}"; the PO answered: ${oneLine(answer)}`;
}

export function withDecision(spec, line) {
  if (spec.trim() === "") return `## Decisions\n\n${line}\n`;
  const lines = spec.trimEnd().split("\n");
  const start = lines.findIndex((text) => /^## Decisions\s*$/.test(text));
  if (start === -1) return `${lines.join("\n")}\n\n## Decisions\n\n${line}\n`;
  const next = lines.findIndex((text, index) => index > start && text.startsWith("## "));
  const end = next === -1 ? lines.length : next;
  let last = end - 1;
  while (last > start && lines[last].trim() === "") last -= 1;
  const insert = last === start ? ["", line] : [line];
  return `${[...lines.slice(0, last + 1), ...insert, ...lines.slice(last + 1)].join("\n")}\n`;
}

export function withoutDecisions(spec) {
  const lines = spec.split("\n");
  const start = lines.findIndex((text) => /^## Decisions\s*$/.test(text));
  if (start === -1) return spec;
  const next = lines.findIndex((text, index) => index > start && text.startsWith("## "));
  const end = next === -1 ? lines.length : next;
  const before = lines.slice(0, start).join("\n").trimEnd();
  const after = lines.slice(end).join("\n");
  return after === "" ? `${before}\n\n` : `${before}\n\n${after}`;
}

export function appendDecision(
  id,
  { role, question, answer },
  env = process.env,
  now = new Date()
) {
  const line = decisionLine({ role, question, answer }, now);
  const specPath = join(taskDir(id, env), "spec.md");
  writeFileSync(specPath, withDecision(readFileSync(specPath, "utf8"), line));
  appendEvent({ event: "decision", task: id, role }, env, now);
  return { line };
}

export function showTask(id, env = process.env) {
  const latestStep = readEvents(env)
    .filter((event) => event.task === id)
    .at(-1);
  return { ...readTask(id, env), latestStep: latestStep ?? null };
}

const COMMANDS = {
  doctor: () => {
    requireTools();
    return { ready: true };
  },
  new: ([title, repo, category]) => newTask({ title, repo, category }),
  prepare: ([id]) => prepare(id),
  status: ([id, status, note]) => setStatus(id, status, note),
  ask: ([id, question]) => recordQuestion(id, question),
  handover: ([id, role, reason, model]) =>
    recordPoHandover(id, role, reason, readFileSync(0, "utf8"), process.env, model),
  review: ([id, round, findings]) => recordReview(id, round, findings),
  test: ([id, unmet]) => recordTest(id, unmet),
  list: () => listTasks(),
  show: ([id]) => showTask(id),
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

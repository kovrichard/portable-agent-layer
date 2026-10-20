import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function factoryHome(env = process.env) {
  return env.DARK_FACTORY_HOME || join(homedir(), ".dark-factory");
}

export function taskDir(id, env = process.env) {
  return join(factoryHome(env), "tasks", id);
}

export function eventsFile(env = process.env) {
  return join(factoryHome(env), "events.jsonl");
}

export function appendEvent(event, env = process.env, now = new Date()) {
  const file = eventsFile(env);
  mkdirSync(dirname(file), { recursive: true });
  const line = `${JSON.stringify({ ts: now.toISOString(), ...event })}\n`;
  appendFileSync(file, line);
  appendToTaskLog(event.task, line, env);
}

function appendToTaskLog(taskId, line, env) {
  if (!taskId) return;
  const dir = taskDir(taskId, env);
  if (existsSync(dir)) appendFileSync(join(dir, "events.jsonl"), line);
}

export function readEvents(env = process.env) {
  const file = eventsFile(env);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function readTask(id, env = process.env) {
  return JSON.parse(readFileSync(join(taskDir(id, env), "task.json"), "utf8"));
}

export function writeTask(task, env = process.env) {
  const dir = taskDir(task.id, env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "task.json"), `${JSON.stringify(task, null, 2)}\n`);
}

const INSTALL_HINTS = {
  git: "install it from https://git-scm.com",
  gh: "install it from https://cli.github.com and sign in with gh auth login",
  bash: "on Windows it comes with Git for Windows",
};

function missingToolMessage(name) {
  return `${name} is not installed or not on PATH; ${INSTALL_HINTS[name] ?? "install it"}`;
}

const BATCH_FILE = /\.(cmd|bat)$/i;
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

function pathEntries(env) {
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  return (key ? env[key] : "").split(";").filter(Boolean);
}

function windowsExecutable(command, env) {
  const extensions = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const candidates = pathEntries(env).flatMap((dir) =>
    extensions.map((extension) => join(dir, `${command}${extension}`))
  );
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function batchFileFor(command, env) {
  if (process.platform !== "win32") return null;
  const resolved = BATCH_FILE.test(command) ? command : windowsExecutable(command, env);
  return resolved && BATCH_FILE.test(resolved) ? resolved : null;
}

function quotedForBatchFile(arg) {
  const escapedQuotes = String(arg)
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, "$1$1");
  return `"${escapedQuotes}"`.replace(CMD_META_CHARS, "^^^$1");
}

// cmd.exe parses a batch file's command line twice (once to start it, again where it expands %*), so each argument is caret-escaped for both passes.
function batchFileCommandLine(file, args) {
  const command = file.replace(CMD_META_CHARS, "^$1");
  return [command, ...args.map(quotedForBatchFile)].join(" ");
}

function spawnArgs(command, args, env) {
  const batchFile = batchFileFor(command, env);
  if (!batchFile) return [command, args, {}];
  return [batchFileCommandLine(batchFile, args), [], { shell: true }];
}

export function spawnTool(command, args, options = {}) {
  const [file, fileArgs, shellOptions] = spawnArgs(
    command,
    args,
    options.env ?? process.env
  );
  const result = spawnSync(file, fileArgs, {
    encoding: "utf8",
    ...options,
    ...shellOptions,
  });
  if (result.error?.code === "ENOENT") throw new Error(missingToolMessage(command));
  return result;
}

function isInstalled(name, env) {
  return spawnSync(name, ["--version"], { env }).error?.code !== "ENOENT";
}

export function requireTools(env = process.env, names = Object.keys(INSTALL_HINTS)) {
  const missing = names.filter((name) => !isInstalled(name, env));
  if (missing.length === 0) return;
  const hints = missing.map(missingToolMessage).join("\n");
  throw new Error(`missing tools: ${missing.join(", ")}\n${hints}`);
}

export function readRepoConfig(repo) {
  const file = join(repo, ".dark-factory.json");
  if (!existsSync(file))
    throw new Error(`${file} is missing; it lists the gate commands for this repo`);
  return JSON.parse(readFileSync(file, "utf8"));
}

export function isMain(moduleUrl) {
  return (
    Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(moduleUrl)
  );
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

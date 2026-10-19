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
  appendFileSync(file, `${JSON.stringify({ ts: now.toISOString(), ...event })}\n`);
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

export function spawnTool(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
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

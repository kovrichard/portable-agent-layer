import { runBuild } from "./build.mjs";
import { appendEvent, isMain, printJson } from "./lib.mjs";
import { buildFiles, releaseLock, writeLock, writeResult } from "./worker.mjs";

const ISOLATIONS = ["systemd-scope", "detached"];

function crashResult(taskId, error) {
  return { task: taskId, status: "stuck", message: error.message, pr: null };
}

function buildOutcome(taskId, env, build) {
  try {
    return build(taskId, { env });
  } catch (error) {
    return crashResult(taskId, error);
  }
}

function isolationOf(isolation) {
  return ISOLATIONS.includes(isolation) ? isolation : "detached";
}

export function runWorker(
  taskId,
  isolation,
  { env = process.env, build = runBuild } = {}
) {
  const files = buildFiles(taskId, env);
  writeLock(files.lock, process.pid);
  appendEvent(
    {
      event: "run_started",
      task: taskId,
      pid: process.pid,
      isolation: isolationOf(isolation),
    },
    env
  );
  const result = buildOutcome(taskId, env, build);
  writeResult(files.result, result);
  releaseLock(files.lock, process.pid);
  return result;
}

if (isMain(import.meta.url)) {
  const [taskId, isolation] = process.argv.slice(2);
  printJson(runWorker(taskId, isolation));
}

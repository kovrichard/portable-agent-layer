import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { PLUGIN_ROOT, spawnTool, taskDir } from "./lib.mjs";
import { setStatus } from "./task.mjs";

const BUILD_WORKER_SCRIPT = join(PLUGIN_ROOT, "scripts", "build-worker.mjs");
const SCOPE_ARGS = ["--user", "--scope", "--collect", "--quiet"];
const PROBE_TIMEOUT_MS = 10_000;
const WAIT_POLL_MS = 250;
const WORKER_DIED =
  "the build worker died before it wrote a result; run the same command again to resume it";

export function buildFiles(taskId, env = process.env) {
  const dir = taskDir(taskId, env);
  return {
    dir,
    lock: join(dir, "build.lock"),
    result: join(dir, "result.json"),
    log: join(dir, "build.log"),
  };
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function readLockPid(lockFile) {
  try {
    const pid = Number(readFileSync(lockFile, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function workerAlive(lockFile) {
  const pid = readLockPid(lockFile);
  return pid !== null && isAlive(pid);
}

export function liveLockPid(dir, alive = isAlive) {
  const lockFile = join(dir, "build.lock");
  const pid = readLockPid(lockFile);
  if (pid !== null && alive(pid)) return pid;
  rmSync(lockFile, { force: true });
  return null;
}

export function writeLock(lockFile, pid) {
  writeFileSync(lockFile, String(pid));
}

export function releaseLock(lockFile, pid) {
  if (readLockPid(lockFile) === pid) rmSync(lockFile, { force: true });
}

function tryCreateLock(files) {
  try {
    writeFileSync(files.lock, String(process.pid), { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}

function claimLock(files) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (liveLockPid(files.dir) !== null) return false;
    if (tryCreateLock(files)) return true;
  }
  return false;
}

export function writeResult(resultFile, result) {
  const temp = `${resultFile}.tmp`;
  writeFileSync(temp, `${JSON.stringify(result)}\n`);
  renameSync(temp, resultFile);
}

function readResult(resultFile) {
  try {
    return JSON.parse(readFileSync(resultFile, "utf8"));
  } catch {
    return null;
  }
}

function probeSystemdScope(env = process.env) {
  try {
    return spawnTool("systemd-run", [...SCOPE_ARGS, "true"], {
      env,
      stdio: "ignore",
      timeout: PROBE_TIMEOUT_MS,
    }).status;
  } catch {
    return 1;
  }
}

export function chooseIsolation({
  platform = process.platform,
  probe = probeSystemdScope,
} = {}) {
  return platform === "linux" && probe() === 0 ? "systemd-scope" : "detached";
}

function workerCommand(taskId, isolation) {
  const baseArgs = [BUILD_WORKER_SCRIPT, taskId, isolation];
  if (isolation === "systemd-scope")
    return {
      command: "systemd-run",
      args: [...SCOPE_ARGS, process.execPath, ...baseArgs],
    };
  return { command: process.execPath, args: baseArgs };
}

function stuckResult(taskId, message) {
  return { task: taskId, status: "stuck", message, pr: null };
}

function startWorker(taskId, files, env) {
  rmSync(files.result, { force: true });
  const isolation = chooseIsolation({ probe: () => probeSystemdScope(env) });
  const { command, args } = workerCommand(taskId, isolation);
  const logFd = openSync(files.log, "a");
  let child;
  try {
    child = spawn(command, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
      env,
    });
  } finally {
    closeSync(logFd);
  }
  child.on("error", () => {});
  if (child.pid === undefined) {
    rmSync(files.lock, { force: true });
    return stuckResult(taskId, "could not start the build worker");
  }
  writeLock(files.lock, child.pid);
  child.unref();
  return null;
}

function saveStuckStatus(taskId, env) {
  try {
    setStatus(taskId, "stuck", WORKER_DIED, env);
    return null;
  } catch (error) {
    return error.message;
  }
}

function workerDied(taskId, files, env) {
  const statusError = saveStuckStatus(taskId, env);
  rmSync(files.lock, { force: true });
  const message = statusError
    ? `${WORKER_DIED}; could not set the task status to stuck: ${statusError}`
    : WORKER_DIED;
  return stuckResult(taskId, message);
}

async function waitForResult(taskId, files, env) {
  let result = readResult(files.result);
  while (result === null && workerAlive(files.lock)) {
    await sleep(WAIT_POLL_MS);
    result = readResult(files.result);
  }
  return result ?? readResult(files.result) ?? workerDied(taskId, files, env);
}

export async function superviseBuild(taskId, { env = process.env } = {}) {
  const files = buildFiles(taskId, env);
  if (!existsSync(join(files.dir, "task.json")))
    return stuckResult(
      taskId,
      `task ${taskId} does not exist: ${files.dir} has no task.json`
    );
  if (claimLock(files)) {
    const failed = startWorker(taskId, files, env);
    if (failed) return failed;
  }
  return waitForResult(taskId, files, env);
}

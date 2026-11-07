import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  editedTestFiles,
  FINGERPRINT_UNREADABLE,
  filesListedBefore,
  proveTestsRed,
  takeBaseline,
  taskDocumentTexts,
  unplannedFiles,
  worktreeFingerprint,
} from "./build.mjs";
import { runCheck } from "./gate.mjs";
import {
  appendEvent,
  isMain,
  printJson,
  readEvents,
  readTask,
  spawnTool,
  taskDir,
} from "./lib.mjs";
import { changedFilesSince } from "./roles.mjs";

const REAL_EFFECTS = { runCheck, spawnTool, changedFilesSince };

export function latestTaskEvent(events, taskId, name) {
  return events.filter((event) => event.event === name && event.task === taskId).at(-1);
}

export function stepRun(task, taskId, env, effects) {
  return {
    id: taskId,
    env,
    effects,
    worktree: task.worktree,
    base: task.base,
    config: task.config,
    taskDir: taskDir(taskId, env),
    testFixTrees: [],
  };
}

function missingTaskMessage(taskId, env) {
  const file = join(taskDir(taskId, env), "task.json");
  return existsSync(file) ? null : `no task ${taskId}: ${file} does not exist`;
}

function missingWorktreeMessage(task, taskId) {
  return existsSync(task.worktree)
    ? null
    : `the worktree ${task.worktree} of task ${taskId} does not exist`;
}

function failed(message) {
  return { exitCode: 1, result: { message } };
}

function baselineCommand(run) {
  const taken = takeBaseline(run);
  if (taken.stop)
    return { exitCode: 1, result: { failing: null, message: taken.stop.message } };
  appendEvent(
    { event: "tests_baseline", task: run.id, failing: taken.baseline },
    run.env
  );
  return { exitCode: 0, result: { failing: taken.baseline } };
}

function proveRedCommand(run) {
  const baseline = latestTaskEvent(
    readEvents(run.env),
    run.id,
    "tests_baseline"
  )?.failing;
  const stop = proveTestsRed(run, baseline);
  if (stop) return { exitCode: 1, result: { ok: false, message: stop.message } };
  return { exitCode: 0, result: { ok: true } };
}

function snapshotCommand(run) {
  const tree = worktreeFingerprint(run);
  if (tree === null) return failed(FINGERPRINT_UNREADABLE);
  appendEvent({ event: "tree_snapshot", task: run.id, tree }, run.env);
  return { exitCode: 0, result: { tree } };
}

function testEditsCommand(run) {
  const snapshot = latestTaskEvent(readEvents(run.env), run.id, "tree_snapshot");
  if (!snapshot)
    return failed(
      `task ${run.id} has no tree_snapshot event; run step.mjs snapshot ${run.id} first`
    );
  const found = editedTestFiles(run, snapshot.tree, 0);
  if (found.stop) return failed(found.stop.message);
  const files = found.edits.map((edit) => edit.file);
  return { exitCode: files.length === 0 ? 0 : 1, result: { files } };
}

function unplannedCommand(run) {
  const changed = run.effects.changedFilesSince(
    run.worktree,
    `origin/${run.base}`,
    run.env
  );
  const files = unplannedFiles(changed, taskDocumentTexts(run), filesListedBefore(run));
  return { exitCode: 0, result: { files } };
}

const COMMANDS = {
  baseline: baselineCommand,
  "prove-red": proveRedCommand,
  snapshot: snapshotCommand,
  "test-edits": testEditsCommand,
  unplanned: unplannedCommand,
};

const USAGE = `usage: step.mjs ${Object.keys(COMMANDS).join("|")} <task-id>`;

export function runStep(command, taskId, { env = process.env, effects = {} } = {}) {
  if (!Object.hasOwn(COMMANDS, command) || !taskId)
    return { exitCode: 2, result: { message: USAGE } };
  try {
    const noTask = missingTaskMessage(taskId, env);
    if (noTask) return failed(noTask);
    const task = readTask(taskId, env);
    const noWorktree = missingWorktreeMessage(task, taskId);
    if (noWorktree) return failed(noWorktree);
    return COMMANDS[command](stepRun(task, taskId, env, { ...REAL_EFFECTS, ...effects }));
  } catch (error) {
    return failed(error.message);
  }
}

if (isMain(import.meta.url)) {
  const [command, taskId] = process.argv.slice(2);
  const { exitCode, result } = runStep(command, taskId);
  if (exitCode === 2) process.stderr.write(`${USAGE}\n`);
  else printJson(result);
  process.exitCode = exitCode;
}

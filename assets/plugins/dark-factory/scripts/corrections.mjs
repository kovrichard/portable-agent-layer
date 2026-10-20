import { appendEvent, readEvents } from "./lib.mjs";
import { run } from "./ship.mjs";
import { listTasks } from "./task.mjs";

export const MAX_CORRECTION_DIFF_CHARS = 20000;
const TRUNCATED_MARK = "\n[truncated]";

function truncated(text) {
  if (text.length <= MAX_CORRECTION_DIFF_CHARS) return text;
  return `${text.slice(0, MAX_CORRECTION_DIFF_CHARS)}${TRUNCATED_MARK}`;
}

export function prMergedAt(task, env = process.env) {
  if (!task.pr) return null;
  const result = run("gh", ["pr", "view", task.pr, "--json", "mergedAt"], task.repo, env);
  if (!result.ok) return null;
  try {
    return JSON.parse(result.out).mergedAt || null;
  } catch {
    return null;
  }
}

function eventsOf(events, taskId, name) {
  return events.filter((event) => event.task === taskId && event.event === name);
}

function isLater(ts, than) {
  return new Date(ts) > new Date(than);
}

function correctionsGivenAfter(events, taskId, ts) {
  return eventsOf(events, taskId, "coach_corrections_given").some((event) =>
    isLater(event.ts, ts)
  );
}

function fetchBranch(task, env) {
  run("git", ["fetch", "origin", task.branch], task.repo, env);
}

function refFor(task, env) {
  const remote = `origin/${task.branch}`;
  const found = run("git", ["rev-parse", "--verify", "--quiet", remote], task.repo, env);
  return found.ok ? remote : task.branch;
}

function shasSince(task, lastPush, ref, env) {
  const args = lastPush.head
    ? ["rev-list", "--reverse", `${lastPush.head}..${ref}`]
    : ["rev-list", "--reverse", "--first-parent", `--since=${lastPush.ts}`, ref];
  const result = run("git", args, task.repo, env);
  return result.ok ? result.out.split("\n").filter(Boolean) : [];
}

function commitOf(task, sha, env) {
  return {
    sha,
    message: run("git", ["log", "-1", "--format=%B", sha], task.repo, env).out,
    diff: truncated(
      run("git", ["show", "--format=", "--patch", sha], task.repo, env).out
    ),
  };
}

function correctionOf(task, events, env) {
  if (!task.pr || !task.branch) return [];
  const lastPush = eventsOf(events, task.id, "pushed").at(-1);
  if (!lastPush || correctionsGivenAfter(events, task.id, lastPush.ts)) return [];
  const mergedAt = prMergedAt(task, env);
  if (!mergedAt || !isLater(mergedAt, lastPush.ts)) return [];
  fetchBranch(task, env);
  const shas = shasSince(task, lastPush, refFor(task, env), env);
  const commits = shas.map((sha) => commitOf(task, sha, env));
  return commits.length > 0 ? [{ task: task.id, pr: task.pr, commits }] : [];
}

export function userCorrections(env = process.env) {
  const events = readEvents(env);
  return listTasks(env).flatMap((task) => correctionOf(task, events, env));
}

export function recordCorrectionsGiven(corrections, env = process.env) {
  for (const correction of corrections) {
    appendEvent(
      {
        event: "coach_corrections_given",
        task: correction.task,
        commits: correction.commits.map((commit) => commit.sha),
      },
      env
    );
  }
}

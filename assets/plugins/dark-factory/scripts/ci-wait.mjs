import { appendEvent, isMain, printJson, readTask, spawnTool } from "./lib.mjs";

const POLL_MS = 30_000;
const TIMEOUT_MS = 9 * 60_000;

function isFailed(check) {
  return check.bucket === "fail" || check.bucket === "cancel";
}

export function classifyChecks(checks) {
  if (checks.length === 0) return { state: "none", failed: [] };
  const failed = checks.filter(isFailed).map((check) => check.name);
  if (failed.length) return { state: "fail", failed };
  if (checks.some((check) => check.bucket === "pending"))
    return { state: "pending", failed: [] };
  return { state: "pass", failed: [] };
}

export function checksFrom(result) {
  if (result.status === 0 || result.stdout) return JSON.parse(result.stdout || "[]");
  if (result.stderr.includes("no checks reported")) return [];
  throw new Error(`gh pr checks failed: ${result.stderr.trim()}`);
}

export function failedRunIds(checks) {
  const ids = checks
    .filter(isFailed)
    .map((check) => check.link?.match(/\/actions\/runs\/(\d+)/)?.[1])
    .filter(Boolean);
  return [...new Set(ids)];
}

function requireSha(head) {
  if (typeof head !== "string" || head === "")
    throw new Error("gh pr view returned no head commit");
  return head;
}

export function headFrom(result) {
  if (result.status !== 0) throw new Error(`gh pr view failed: ${result.stderr.trim()}`);
  return requireSha(JSON.parse(result.stdout || "{}").headRefOid);
}

function readChecks(pr, cwd, env) {
  return checksFrom(
    spawnTool("gh", ["pr", "checks", pr, "--json", "name,bucket,link"], { cwd, env })
  );
}

function readPrHeadFromGh(pr, cwd, env) {
  return headFrom(
    spawnTool("gh", ["pr", "view", pr, "--json", "headRefOid"], { cwd, env })
  );
}

function readLocalHeadFromGit(cwd, env) {
  const result = spawnTool("git", ["rev-parse", "HEAD"], { cwd, env });
  if (result.status !== 0 || result.stdout.trim() === "")
    throw new Error(`could not read the worktree HEAD: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readSnapshot(task, env, readers) {
  const sha = requireSha(readers.readPrHead(task.pr, task.worktree, env));
  const checks = readers.read(task.pr, task.worktree, env);
  const current = sha === readers.readLocalHead(task.worktree, env);
  return { sha, checks, current };
}

export function failedLinks(checks) {
  return checks.filter(isFailed).map((check) => check.link);
}

function stillStale(checks, staleLinks) {
  const stale = new Set(staleLinks);
  return checks.some((check) => isFailed(check) && stale.has(check.link));
}

function outcomeAt(snapshot, staleLinks) {
  if (!snapshot.current) return { state: "pending", failed: [] };
  if (stillStale(snapshot.checks, staleLinks)) return { state: "pending", failed: [] };
  return classifyChecks(snapshot.checks);
}

export function waitForCi(
  id,
  {
    env = process.env,
    read = readChecks,
    readPrHead = readPrHeadFromGh,
    readLocalHead = readLocalHeadFromGit,
    pause = sleep,
    pollMs = POLL_MS,
    timeoutMs = TIMEOUT_MS,
    staleLinks = [],
  } = {}
) {
  const task = readTask(id, env);
  const readers = { read, readPrHead, readLocalHead };
  const graceForChecksToAppear = 4;
  for (let waited = 0, polls = 0; waited <= timeoutMs; waited += pollMs, polls += 1) {
    const snapshot = readSnapshot(task, env, readers);
    const outcome = outcomeAt(snapshot, staleLinks);
    const settled = outcome.state === "pass" || outcome.state === "fail";
    if (settled || (outcome.state === "none" && polls >= graceForChecksToAppear)) {
      appendEvent(
        {
          event: "ci",
          task: id,
          result: outcome.state,
          failed: outcome.failed,
          sha: snapshot.sha,
        },
        env
      );
      return {
        ...outcome,
        sha: snapshot.sha,
        runs: failedRunIds(snapshot.checks),
        links: failedLinks(snapshot.checks),
      };
    }
    pause(pollMs);
  }
  return { state: "pending", failed: [] };
}

const EXIT_CODES = { pass: 0, fail: 1, none: 2, pending: 3 };

if (isMain(import.meta.url)) {
  const [id, seconds] = process.argv.slice(2);
  const outcome = waitForCi(id, seconds ? { timeoutMs: Number(seconds) * 1000 } : {});
  printJson(outcome);
  process.exit(EXIT_CODES[outcome.state]);
}

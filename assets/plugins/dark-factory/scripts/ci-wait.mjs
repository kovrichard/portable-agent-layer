import { appendEvent, isMain, printJson, readTask, spawnTool } from "./lib.mjs";

const POLL_MS = 30_000;
const TIMEOUT_MS = 9 * 60_000;

export function classifyChecks(checks) {
  if (checks.length === 0) return { state: "none", failed: [] };
  const failed = checks
    .filter((check) => check.bucket === "fail" || check.bucket === "cancel")
    .map((check) => check.name);
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

function readChecks(pr, cwd, env) {
  return checksFrom(
    spawnTool("gh", ["pr", "checks", pr, "--json", "name,bucket"], { cwd, env })
  );
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function waitForCi(
  id,
  {
    env = process.env,
    read = readChecks,
    pause = sleep,
    pollMs = POLL_MS,
    timeoutMs = TIMEOUT_MS,
  } = {}
) {
  const task = readTask(id, env);
  const graceForChecksToAppear = 4;
  for (let waited = 0, polls = 0; waited <= timeoutMs; waited += pollMs, polls += 1) {
    const outcome = classifyChecks(read(task.pr, task.worktree, env));
    const settled = outcome.state === "pass" || outcome.state === "fail";
    if (settled || (outcome.state === "none" && polls >= graceForChecksToAppear)) {
      appendEvent(
        { event: "ci", task: id, result: outcome.state, failed: outcome.failed },
        env
      );
      return outcome;
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

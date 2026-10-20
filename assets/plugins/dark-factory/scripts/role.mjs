import { join } from "node:path";
import { appendEvent, isMain, printJson, readTask, spawnTool, taskDir } from "./lib.mjs";
import { policyFor } from "./roles.mjs";

export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const TIMEOUT_EXIT = 124;
const MISSING_EXIT = 127;
const SETUP_EXIT = 2;
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const USAGE =
  "usage: role.mjs <task-id> <role> [--max-budget-usd <usd>] [--timeout-ms <ms>] [-- <extra claude args>]";
const NUMERIC_FLAGS = { "--max-budget-usd": "budgetUsd", "--timeout-ms": "timeoutMs" };

const ROLE_INSTRUCTIONS = {
  architect: "Write design.md for this change.",
  planner: "Write plan.md for this change.",
  debugger:
    "Reproduce the bug described in the spec and write repro.md with the root cause.",
  "test-writer":
    "Write the failing tests for every acceptance criterion and commit them.",
  "code-writer":
    "Implement the change described in plan.md when it exists, otherwise in the spec.",
  reviewer:
    'Review the branch diff against its base and the spec. Report each finding with its file, line, what is wrong and what would fix it, or reply "No findings." when there are none.',
  tester:
    "Test every acceptance criterion in the running app. Report each criterion as met or not met, with what you did and what you saw.",
  po: 'Read the spec and list every question in it that only the user can answer, or reply "No questions." when there are none.',
};

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr(value) {
  return typeof value === "number" ? value : null;
}

function stringOr(value) {
  return typeof value === "string" ? value : null;
}

function modelUsageOf(reply) {
  return isPlainObject(reply.modelUsage) ? reply.modelUsage : {};
}

function costOf([, usage]) {
  return numberOr(usage?.costUSD) ?? -1;
}

function mainModel(modelUsage) {
  const entries = Object.entries(modelUsage);
  if (entries.length === 0) return null;
  return entries.reduce((best, entry) =>
    costOf(entry) > costOf(best) ? entry : best
  )[0];
}

function tokens(reply, modelKey, usageKey) {
  const entries = Object.values(modelUsageOf(reply));
  if (entries.length === 0) return numberOr(reply.usage?.[usageKey]);
  const values = entries
    .map((entry) => entry?.[modelKey])
    .filter((value) => typeof value === "number");
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
}

export function statsFrom(reply) {
  return {
    model: mainModel(modelUsageOf(reply)),
    result: stringOr(reply.result),
    costUsd: numberOr(reply.total_cost_usd),
    inputTokens: tokens(reply, "inputTokens", "input_tokens"),
    outputTokens: tokens(reply, "outputTokens", "output_tokens"),
    cacheReadTokens: tokens(reply, "cacheReadInputTokens", "cache_read_input_tokens"),
    cacheCreationTokens: tokens(
      reply,
      "cacheCreationInputTokens",
      "cache_creation_input_tokens"
    ),
    turns: numberOr(reply.num_turns),
    durationMs: numberOr(reply.duration_ms),
    sessionId: stringOr(reply.session_id),
  };
}

function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

export function parseClaudeReply(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  return parseObject(text) ?? parseObject(text.split("\n").at(-1));
}

function emptyStats() {
  return statsFrom({});
}

function failed(taskId, role, exitCode, error, stats = emptyStats()) {
  return { task: taskId, role, ...stats, exitCode, error };
}

function tail(text, size = 500) {
  return String(text ?? "")
    .trim()
    .slice(-size);
}

function firstReplyError(reply) {
  if (Array.isArray(reply.errors) && reply.errors.length > 0)
    return reply.errors.join("; ");
  if (typeof reply.result === "string" && reply.result.length > 0) return reply.result;
  return stringOr(reply.subtype);
}

function replyError(reply, status) {
  if (status === 0 && reply.is_error !== true) return null;
  return firstReplyError(reply) ?? `claude exited with code ${status}`;
}

function exitCodeFor(status, error) {
  if (status !== 0) return status;
  if (error) return 1;
  return 0;
}

function spawnClaude(invocation, timeoutMs, env) {
  try {
    return spawnTool(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env,
      input: invocation.prompt,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: MAX_BUFFER_BYTES,
    });
  } catch (error) {
    return { missing: error.message };
  }
}

function timedOut(spawned) {
  return spawned.error?.code === "ETIMEDOUT" || spawned.signal === "SIGKILL";
}

function noReplyOutcome(taskId, role, spawned, status) {
  if (status !== 0)
    return failed(
      taskId,
      role,
      status,
      `claude exited with code ${status}: ${tail(spawned.stderr)}`
    );
  return failed(taskId, role, 1, `claude printed no JSON: ${tail(spawned.stdout, 200)}`);
}

function replyOutcome(taskId, role, spawned) {
  const status = spawned.status ?? 1;
  const reply = parseClaudeReply(spawned.stdout);
  if (reply === null) return noReplyOutcome(taskId, role, spawned, status);
  const error = replyError(reply, status);
  return {
    task: taskId,
    role,
    ...statsFrom(reply),
    exitCode: exitCodeFor(status, error),
    error,
  };
}

function outcomeFrom(taskId, role, spawned, timeoutMs) {
  if (spawned.missing) return failed(taskId, role, MISSING_EXIT, spawned.missing);
  if (timedOut(spawned))
    return failed(
      taskId,
      role,
      TIMEOUT_EXIT,
      `claude did not finish within ${timeoutMs} ms and was stopped`
    );
  if (spawned.error)
    return failed(taskId, role, 1, `could not start claude: ${spawned.error.message}`);
  return replyOutcome(taskId, role, spawned);
}

export function rolePrompt(task, role, env = process.env) {
  const folder = taskDir(task.id, env);
  return [
    `Task ${task.id}: ${task.title}`,
    `Task folder: ${folder} (the spec is ${join(folder, "spec.md")}; plan.md, design.md, repro.md and tests.md live here when they exist).`,
    `Work only inside the git worktree ${task.worktree}. The branch is ${task.branch}, based on ${task.base}.`,
    "Never ask the user anything. If you cannot continue without an answer, say what you need and stop.",
    "",
    ROLE_INSTRUCTIONS[role],
  ].join("\n");
}

function disallowedArgs(deny) {
  return deny.length > 0 ? ["--disallowedTools", deny.join(",")] : [];
}

export function claudeInvocation(
  task,
  role,
  { budgetUsd = 0, extraArgs = [], env = process.env } = {}
) {
  const policy = policyFor(role);
  return {
    command: "claude",
    cwd: task.worktree,
    prompt: rolePrompt(task, role, env),
    args: [
      "-p",
      "--agent",
      `dark-factory:${role}`,
      "--output-format",
      "json",
      "--max-budget-usd",
      String(budgetUsd > 0 ? budgetUsd : policy.budgetUsd),
      "--permission-mode",
      "dontAsk",
      "--add-dir",
      taskDir(task.id, env),
      "--allowedTools",
      policy.allow.join(","),
      ...disallowedArgs(policy.deny),
      ...extraArgs,
    ],
  };
}

function withoutResult(outcome) {
  return Object.fromEntries(Object.entries(outcome).filter(([key]) => key !== "result"));
}

function recordFinished(outcome, env) {
  appendEvent({ event: "role_finished", ...withoutResult(outcome) }, env);
}

function attempt(taskId, role, { env, budgetUsd, timeoutMs, extraArgs }) {
  try {
    const task = readTask(taskId, env);
    const invocation = claudeInvocation(task, role, { budgetUsd, extraArgs, env });
    return outcomeFrom(taskId, role, spawnClaude(invocation, timeoutMs, env), timeoutMs);
  } catch (error) {
    return failed(taskId, role, SETUP_EXIT, error.message);
  }
}

export function runRoleHeadless(
  taskId,
  role,
  { env = process.env, budgetUsd, timeoutMs = DEFAULT_TIMEOUT_MS, extraArgs = [] } = {}
) {
  const outcome = attempt(taskId, role, { env, budgetUsd, timeoutMs, extraArgs });
  recordFinished(outcome, env);
  return outcome;
}

function positiveNumber(flag, value) {
  const number = Number(value);
  if (!(Number.isFinite(number) && number > 0))
    throw new Error(`${flag} needs a positive number`);
  return number;
}

function splitFlags(tokens) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    if (!Object.hasOwn(NUMERIC_FLAGS, token)) throw new Error(USAGE);
    flags[NUMERIC_FLAGS[token]] = positiveNumber(token, tokens[index + 1]);
    index += 1;
  }
  return { positionals, flags };
}

export function parseCliArgs(argv) {
  const separator = argv.indexOf("--");
  const head = separator === -1 ? argv : argv.slice(0, separator);
  const extraArgs = separator === -1 ? [] : argv.slice(separator + 1);
  const { positionals, flags } = splitFlags(head);
  if (positionals.length !== 2) throw new Error(USAGE);
  const [taskId, role] = positionals;
  return {
    taskId,
    role,
    budgetUsd: flags.budgetUsd,
    timeoutMs: flags.timeoutMs,
    extraArgs,
  };
}

function mainOutcome(argv) {
  try {
    const { taskId, role, budgetUsd, timeoutMs, extraArgs } = parseCliArgs(argv);
    return runRoleHeadless(taskId, role, { budgetUsd, timeoutMs, extraArgs });
  } catch (error) {
    return failed(argv[0] ?? null, argv[1] ?? null, SETUP_EXIT, error.message);
  }
}

if (isMain(import.meta.url)) {
  const outcome = mainOutcome(process.argv.slice(2));
  printJson(outcome);
  process.exit(outcome.exitCode);
}

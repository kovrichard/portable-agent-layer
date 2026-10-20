import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { prMergedAt, recordCorrectionsGiven, userCorrections } from "./corrections.mjs";
import {
  applyCoachResult,
  diffNames,
  findingById,
  markApprovedWithLockHeld,
  readFindings,
  rejectFinding,
  withFindingsLock,
  writeFindings,
} from "./findings.mjs";
import {
  appendEvent,
  isMain,
  PLUGIN_ROOT,
  printJson,
  readEvents,
  readTask,
  readUserConfig,
  taskDir,
} from "./lib.mjs";
import { runRoleHeadless, transcriptPathFor } from "./role.mjs";
import { run } from "./ship.mjs";
import { METRICS, metricOver, runsOf } from "./stats.mjs";
import { newTask } from "./task.mjs";

const COACHED_STATUSES = ["ready", "stuck"];
const ARTIFACT_NAMES = ["plan.md", "design.md", "repro.md", "tests.md"];
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const MIN_RUNS_AFTER = 3;
const ARG_COUNTS = { run: 1, list: 0, show: 1, reject: 2, approve: 1 };
const USAGE =
  'usage: coach.mjs run <task-id> | list [--applied] | show <id> | reject <id> "<reason>" | approve <id> [--repo <path>]';

function swallow(action) {
  try {
    action();
  } catch {
    return false;
  }
  return true;
}

export function startCoach(taskId, status, env = process.env) {
  if (!COACHED_STATUSES.includes(status)) return;
  try {
    appendEvent({ event: "coach_started", task: taskId }, env);
    spawn(process.execPath, [join(PLUGIN_ROOT, "scripts", "coach.mjs"), "run", taskId], {
      detached: true,
      stdio: "ignore",
      env,
    }).unref();
  } catch (error) {
    swallow(() =>
      appendEvent({ event: "coach_failed", task: taskId, error: error.message }, env)
    );
  }
}

function discardedEveryRule(applied) {
  const stored = applied.created.length + applied.updated.length;
  return (
    stored === 0 && applied.events.some((event) => event.event === "coach_rule_rejected")
  );
}

function coachFailed(taskId, error, env) {
  appendEvent({ event: "coach_failed", task: taskId, error }, env);
  return { task: taskId, error };
}

function runDiff(task, env) {
  if (task.pr) {
    const result = run("gh", ["pr", "diff", task.pr], task.repo, env);
    if (!result.ok) throw new Error(`could not read the run's diff: ${result.err}`);
    return { text: result.out, command: `gh pr diff ${task.pr}` };
  }
  const range = `origin/${task.base}...HEAD`;
  const result = run("git", ["diff", range], task.worktree, env);
  if (!result.ok) throw new Error(`could not read the run's diff: ${result.err}`);
  return { text: result.out, command: `git diff ${range}` };
}

function artifactPaths(dir) {
  return ARTIFACT_NAMES.map((name) => join(dir, name)).filter((path) => existsSync(path));
}

function taskTranscripts(task, env) {
  return readEvents(env)
    .filter((event) => event.task === task.id && event.event === "role_finished")
    .filter((event) => event.role !== "coach")
    .map((event) => ({
      role: event.role,
      sessionId: event.sessionId,
      path:
        event.transcriptPath ?? transcriptPathFor(task.worktree, event.sessionId, env),
    }))
    .filter((transcript) => transcript.path);
}

function openFindingsOf(env) {
  return readFindings(env).filter(
    (finding) => finding.status === "pending" || finding.status === "rejected"
  );
}

function listOrNone(lines) {
  return lines.length > 0 ? lines : ["none"];
}

function findingLine(finding) {
  const rejection = finding.rejectReason ? ` (rejected: ${finding.rejectReason})` : "";
  return `- ${finding.id} [${finding.status}] ${finding.role} · ${finding.class}: ${finding.rule}${rejection}`;
}

function correctionLines(corrections) {
  return corrections.flatMap((correction) =>
    correction.commits.flatMap((commit) => [
      `### ${correction.task} ${commit.sha}`,
      commit.message,
      "```diff",
      commit.diff,
      "```",
    ])
  );
}

export function coachInstructions({
  specPath,
  artifacts,
  eventsPath,
  diffCommand,
  transcripts,
  openFindings,
  corrections,
}) {
  return [
    `Spec: ${specPath}. Its Decisions section is part of the spec.`,
    "Other artifacts:",
    ...listOrNone(artifacts.map((path) => `- ${path}`)),
    `Events of this task: ${eventsPath}`,
    `Diff of the run: run \`${diffCommand}\``,
    "Role transcripts:",
    ...listOrNone(
      transcripts.map((item) => `- ${item.role} · ${item.sessionId} · ${item.path}`)
    ),
    `Role prompts: ${PLUGIN_ROOT}/agents/<role>.md; the po role also covers ${PLUGIN_ROOT}/skills/po/SKILL.md.`,
    `Metrics: ${Object.keys(METRICS).join(", ")}`,
    "Open findings (pending ones take updates, rejected classes must not come back):",
    ...listOrNone(openFindings.map(findingLine)),
    "Corrections the user made after the factory:",
    ...listOrNone(correctionLines(corrections)),
  ].join("\n");
}

function coachRun(taskId, env, now) {
  const task = readTask(taskId, env);
  if (!existsSync(task.worktree))
    throw new Error(`the worktree of ${taskId} is gone: ${task.worktree}`);
  const corrections = userCorrections(env);
  const { text, command } = runDiff(task, env);
  const correctionDiffs = corrections.flatMap((correction) =>
    correction.commits.map((commit) => commit.diff)
  );
  const names = diffNames([text, ...correctionDiffs].join("\n"));
  const dir = taskDir(taskId, env);
  const instructions = coachInstructions({
    specPath: join(dir, "spec.md"),
    artifacts: artifactPaths(dir),
    eventsPath: join(dir, "events.jsonl"),
    diffCommand: command,
    transcripts: taskTranscripts(task, env),
    openFindings: openFindingsOf(env),
    corrections,
  });
  const outcome = runRoleHeadless(taskId, "coach", { env, instructions });
  if (outcome.exitCode !== 0 || outcome.structured === null)
    return coachFailed(taskId, outcome.error ?? "the coach returned no result", env);
  const applied = withFindingsLock(env, () => {
    const result = applyCoachResult(readFindings(env), outcome.structured, {
      taskId,
      names,
      now,
    });
    writeFindings(result.store, env);
    return result;
  });
  for (const event of applied.events) appendEvent(event, env);
  if (!discardedEveryRule(applied)) recordCorrectionsGiven(corrections, env);
  appendEvent(
    {
      event: "coach_finished",
      task: taskId,
      created: applied.created.length,
      updated: applied.updated.length,
    },
    env
  );
  return {
    task: taskId,
    created: applied.created,
    updated: applied.updated,
    rejectedRules: applied.events
      .filter((event) => event.event === "coach_rule_rejected")
      .map((event) => ({ class: event.class, matched: event.matched })),
  };
}

export function runCoach(taskId, { env = process.env, now = new Date() } = {}) {
  try {
    return coachRun(taskId, env, now);
  } catch (error) {
    return coachFailed(taskId, error.message, env);
  }
}

export function approvalSpec(finding) {
  const roleFile = `assets/plugins/dark-factory/agents/${finding.role}.md`;
  const roleFiles =
    finding.role === "po"
      ? [roleFile, "assets/plugins/dark-factory/skills/po/SKILL.md"]
      : [roleFile];
  return [
    `# Coach: ${finding.role} ${finding.class}`,
    "",
    "## Goal",
    `Change the ${finding.role} role prompt so that this class of mistake stops: ${finding.class}.`,
    "",
    "## Rule",
    `> ${finding.rule}`,
    "",
    "## Role file",
    ...roleFiles.map((file) => `- \`${file}\``),
    "",
    "## Evidence",
    ...finding.evidence.map((item) => `- ${item.task}: ${item.ref}`),
    `Would also have prevented: ${finding.elsewhere}`,
    "",
    "## Metric",
    `\`${finding.metric}\` from \`scripts/stats.mjs\` METRICS; \`node scripts/coach.mjs list --applied\` reports it after the merge.`,
    "",
    "## Acceptance criteria",
    "1. The rule is in the role file.",
    "2. It is worded for a class of mistake, with no task-specific file or helper names.",
    "3. A role prompt over 40 lines is consolidated rather than extended.",
    "",
    "## Out of scope",
    "Changes to any other role prompt.",
    "",
  ].join("\n");
}

export function approveFinding(id, options = {}) {
  const env = options.env ?? process.env;
  return withFindingsLock(env, () => approveFindingLocked(id, options));
}

function approveFindingLocked(id, { repo, env = process.env, now = new Date() }) {
  const finding = findingById(id, env);
  if (finding.status !== "pending")
    throw new Error(`finding ${id} is ${finding.status}, not pending`);
  const repoPath = repo ? resolve(repo) : readUserConfig(env).coach?.repo;
  if (!repoPath)
    throw new Error(
      "no plugin repo: pass --repo <path> or set coach.repo in $DARK_FACTORY_HOME/config.json"
    );
  const { id: taskId, specPath } = newTask(
    {
      title: `Coach: ${finding.role} ${finding.class}`,
      repo: repoPath,
      category: "small",
    },
    env,
    now
  );
  writeFileSync(specPath, approvalSpec(finding));
  markApprovedWithLockHeld(id, taskId, env, now);
  appendEvent({ event: "coach_finding_approved", id, task: taskId }, env);
  return { id, task: taskId, specPath };
}

function severityThenId(a, b) {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );
}

function groupByRole(rows) {
  const groups = new Map();
  for (const row of rows) groups.set(row.role, [...(groups.get(row.role) ?? []), row]);
  return [...groups].map(([role, findings]) => ({
    role,
    findings: findings.sort(severityThenId),
  }));
}

function bestRank(group) {
  return Math.min(...group.findings.map((finding) => SEVERITY_RANK[finding.severity]));
}

export function listFindings(env = process.env) {
  const rows = readFindings(env)
    .filter((finding) => finding.status === "pending")
    .map((finding) => ({
      id: finding.id,
      role: finding.role,
      class: finding.class,
      severity: finding.severity,
      rule: finding.rule,
      metric: finding.metric,
      evidenceCount: finding.evidence.length,
    }));
  return groupByRole(rows).sort(
    (a, b) => bestRank(a) - bestRank(b) || a.role.localeCompare(b.role)
  );
}

function mergedAtOf(taskId, env) {
  try {
    return prMergedAt(readTask(taskId, env), env);
  } catch {
    return null;
  }
}

function appliedRow(finding, env) {
  const mergedAt = mergedAtOf(finding.taskId, env);
  if (!mergedAt) return null;
  const runs = runsOf(readEvents(env)).filter((item) => item.task !== finding.taskId);
  const mergedMs = new Date(mergedAt).getTime();
  const before = runs.filter((item) => new Date(item.finishedAt).getTime() < mergedMs);
  const after = runs.filter((item) => new Date(item.finishedAt).getTime() > mergedMs);
  return {
    id: finding.id,
    role: finding.role,
    class: finding.class,
    metric: finding.metric,
    mergedAt,
    before: metricOver(finding.metric, before),
    after:
      after.length < MIN_RUNS_AFTER
        ? "not enough runs"
        : metricOver(finding.metric, after),
    runsAfter: after.length,
  };
}

export function appliedReport(env = process.env) {
  return readFindings(env)
    .filter((finding) => finding.status === "approved" && finding.taskId)
    .map((finding) => appliedRow(finding, env))
    .filter(Boolean);
}

function repoFlag(args) {
  const index = args.indexOf("--repo");
  return index === -1 ? undefined : args[index + 1];
}

function executeCommand(command, args) {
  if (command === "run") return runCoach(args[0]);
  if (command === "list")
    return args.includes("--applied") ? appliedReport() : listFindings();
  if (command === "show") return findingById(args[0]);
  if (command === "reject") return rejectFinding(args[0], args[1]);
  return approveFinding(args[0], { repo: repoFlag(args) });
}

function usageExit() {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

function commandExit(command, outcome) {
  printJson(outcome);
  process.exit(command === "run" && outcome.error ? 1 : 0);
}

if (isMain(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (!Object.hasOwn(ARG_COUNTS, command) || args.length < ARG_COUNTS[command])
    usageExit();
  try {
    commandExit(command, executeCommand(command, args));
  } catch (error) {
    printJson({ error: error.message });
    process.exit(2);
  }
}

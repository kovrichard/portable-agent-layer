import { cacheWriteSplit, isMain, printJson, readEvents } from "./lib.mjs";
import { tokenCost } from "./prices.mjs";

function countBy(items, key) {
  const counts = {};

  for (const item of items) {
    const value = typeof key === "function" ? key(item) : item[key];
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

function firstTryPassRate(gates) {
  const firstTries = gates.filter((gate) => gate.attempt === 1);
  if (firstTries.length === 0) return null;

  return firstTries.filter((gate) => gate.result === "pass").length / firstTries.length;
}

export function summarize(events) {
  const of = (name) => events.filter((event) => event.event === name);
  const gates = of("gate");
  const codeGates = gates.filter((gate) => gate.role === "code-writer");
  const finals = of("task_status").filter((event) =>
    ["ready", "stuck", "waiting"].includes(event.status)
  );

  return {
    tasks: of("task_created").length,
    byCategory: countBy(of("task_created"), "category"),
    outcomes: countBy(finals, "status"),
    gateFailuresByCheck: countBy(
      of("gate_check").filter((check) => check.result === "fail"),
      "check"
    ),
    gateFailuresByRole: countBy(
      gates.filter((gate) => gate.result === "fail"),
      "role"
    ),
    codeWriterFirstTryPassRate: firstTryPassRate(codeGates),
    escalations: countBy(of("escalation"), (event) => `${event.from}->${event.to}`),
    ciResults: countBy(of("ci"), "result"),
    reviewRounds: of("review").length,
    questionsToUser: of("question_to_user").length,
    rolesAddedByDiff: countBy(of("roles_added"), "role"),
    roleRuns: countBy(of("role_run"), "role"),
    handovers: countBy(of("handover"), (event) => `${event.from}->${event.to}`),
    handoversByReason: countBy(of("handover"), "reason"),
    estimates: estimateAccuracy(runsOf(events)),
    costByRole: costByRole(withoutCumulative(of("role_finished"))),
  };
}

const ofName = (events, name) => events.filter((event) => event.event === name);

export const METRICS = {
  firstTryGatePass: (events) => {
    const first = ofName(events, "gate").find((gate) => gate.attempt === 1);

    return first?.result === "pass" ? 1 : 0;
  },
  reviewFindings: (events) =>
    ofName(events, "review").reduce((sum, review) => sum + (review.findings ?? 0), 0),
  fixRounds: (events) => Math.max(0, ofName(events, "gate").length - 1),
  testerRounds: (events) =>
    ofName(events, "test").filter((test) => test.unmet > 0).length,
  questionsToUser: (events) => ofName(events, "question_to_user").length,
  costUsd: (events) => ofName(events, "run_finished").at(-1)?.costUsd ?? 0,
};

const isAfterRunFinished = (event) =>
  event.event === "role_finished" && event.afterRunFinished === true;

function attachAfter(runs, event) {
  const run = runs.findLast((r) => r.task === event.task && r.finishedAt < event.ts);
  run?.after.push(event);
}

export function runsOf(events) {
  const runs = [];
  const open = new Map();

  for (const event of events) {
    if (event.event === "task_started") {
      open.set(event.task, { task: event.task, events: [event] });
      continue;
    }

    if (isAfterRunFinished(event)) {
      attachAfter(runs, event);
      continue;
    }

    const run = open.get(event.task);
    if (!run) continue;
    run.events.push(event);

    if (event.event === "run_finished") {
      runs.push({
        task: run.task,
        finishedAt: event.ts,
        events: run.events,
        after: [],
      });
      open.delete(event.task);
    }
  }

  return runs;
}

function runCostUsd(run) {
  const finishedCost = run.events.at(-1).costUsd ?? null;
  const tailCost = costTotal(run.after).costUsd;
  if (finishedCost === null && tailCost === null) return null;

  return (finishedCost ?? 0) + (tailCost ?? 0);
}

function median(values) {
  const numbers = values
    .filter((value) => typeof value === "number")
    .sort((a, b) => a - b);
  if (numbers.length === 0) return null;
  const middle = Math.floor(numbers.length / 2);

  if (numbers.length % 2 === 1) return numbers[middle];

  return (numbers[middle - 1] + numbers[middle]) / 2;
}

export function estimateFor(events, category) {
  const history = runsOf(events)
    .filter(
      (run) => run.events.at(-1).status === "ready" && run.events[0].category === category
    )
    .slice(-10);
  const finished = history.map((run) => run.events.at(-1));

  return {
    wallMs: median(finished.map((event) => event.wallMs)),
    tokens: median(history.map(runTokens)),
    costUsd: median(history.map(runCostUsd)),
    basis: history.length,
  };
}

const TOKEN_KINDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
];

function runTokens(run) {
  const finished = run.events.at(-1);
  if (typeof finished.tokens !== "number") return finished.tokens;

  return (
    finished.tokens + TOKEN_KINDS.reduce((sum, field) => sum + total(run.after, field), 0)
  );
}

function actualOf(run) {
  const finished = run.events.at(-1);

  return {
    ...finished,
    costUsd: runCostUsd(run),
    tokens: runTokens(run),
  };
}

function estimateAccuracy(runs) {
  const pairs = runs
    .map((run) => ({
      estimate: run.events.find((event) => event.event === "estimate"),
      actual: actualOf(run),
    }))
    .filter((pair) => pair.estimate && pair.estimate.basis > 0);
  const ratios = (field) =>
    median(
      pairs
        .filter(
          ({ estimate, actual }) =>
            typeof estimate[field] === "number" &&
            typeof actual[field] === "number" &&
            estimate[field] !== 0
        )
        .map(({ estimate, actual }) => actual[field] / estimate[field])
    );

  return {
    runs: pairs.length,
    wallRatio: ratios("wallMs"),
    tokensRatio: ratios("tokens"),
    costRatio: ratios("costUsd"),
  };
}

export function metricOver(name, runs) {
  if (!Object.hasOwn(METRICS, name)) throw new Error(`unknown metric "${name}"`);

  if (runs.length === 0) return null;
  const values = runs.map((run) => METRICS[name](run.events));

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function groupBy(items, keyOf) {
  const groups = new Map();

  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  return groups;
}

function eventCost(event) {
  if (typeof event.costUsd === "number")
    return { costUsd: event.costUsd, costEstimated: false };
  const split = cacheWriteSplit(
    event.cacheCreationTokens,
    event.cacheCreation5mTokens,
    event.cacheCreation1hTokens
  );
  const cost = tokenCost(event.model, {
    input: event.inputTokens,
    output: event.outputTokens,
    cacheRead: event.cacheReadTokens,
    cacheWrite5m: split.fiveMin,
    cacheWrite1h: split.oneHour,
  });
  if (cost === null) return { costUsd: null, costEstimated: false };

  return { costUsd: cost, costEstimated: true };
}

function costTotal(events) {
  const priced = events.map(eventCost);
  const known = priced.filter((p) => p.costUsd !== null);

  return {
    costUsd: known.length ? known.reduce((sum, p) => sum + p.costUsd, 0) : null,
    costEstimated: priced.some((p) => p.costEstimated),
  };
}

function total(events, field) {
  return events.reduce((sum, event) => sum + (event[field] ?? 0), 0);
}

function roleRows(roleEvents) {
  const groups = groupBy(roleEvents, (e) => JSON.stringify([e.role, e.model ?? null]));

  return [...groups.values()].map((group) => ({
    role: group[0].role,
    model: group[0].model ?? null,
    runs: group.filter((e) => !e.afterRunFinished).length,
    turns: total(group, "turns"),
    toolCalls: total(group, "toolCalls"),
    durationMs: total(group, "durationMs"),
    inputTokens: total(group, "inputTokens"),
    outputTokens: total(group, "outputTokens"),
    cacheReadTokens: total(group, "cacheReadTokens"),
    cacheCreationTokens: total(group, "cacheCreationTokens"),
    ...costTotal(group),
  }));
}

function runReport({ events: runEvents, after }) {
  const last = runEvents.at(-1);
  const finished = last.event === "run_finished" ? last : null;
  const estimate = runEvents.find((e) => e.event === "estimate");
  const roles = [...runEvents.filter((e) => e.event === "role_finished"), ...after];

  return {
    status: finished?.status ?? null,
    startedAt: runEvents[0].ts,
    finishedAt: finished?.ts ?? null,
    wallMs: finished?.wallMs ?? null,
    ...costTotal(roles),
    tokens: {
      input: total(roles, "inputTokens"),
      output: total(roles, "outputTokens"),
      cacheRead: total(roles, "cacheReadTokens"),
      cacheCreation: total(roles, "cacheCreationTokens"),
    },
    estimate: estimate
      ? {
          category: estimate.category,
          basis: estimate.basis,
          wallMs: estimate.wallMs,
          tokens: estimate.tokens,
          costUsd: estimate.costUsd,
        }
      : null,
    byRole: roleRows(roles),
  };
}

const CUMULATIVE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
  "cacheCreation5mTokens",
  "cacheCreation1hTokens",
  "turns",
];

function withoutCumulative(events) {
  const last = new Map();

  return events.map((event) => {
    if (event.event !== "role_finished" || event.agentId == null) return event;
    const key = JSON.stringify([event.task, event.agentId]);
    const earlier = last.get(key);
    last.set(key, event);

    if ("costUsd" in event || !earlier) return event;
    const subtracted = {};

    for (const field of CUMULATIVE_FIELDS) {
      if (typeof event[field] === "number") {
        subtracted[field] = Math.max(0, event[field] - (earlier[field] ?? 0));
      }
    }

    return { ...event, ...subtracted };
  });
}

function taskRuns(events, taskId) {
  const mine = withoutCumulative(events.filter((e) => e.task === taskId));
  const finished = runsOf(mine).map((run) => ({
    events: run.events,
    after: run.after,
  }));
  const start = mine.findLastIndex((e) => e.event === "task_started");
  const open =
    start !== -1 && !mine.slice(start + 1).some((e) => e.event === "run_finished")
      ? [{ events: mine.slice(start).filter((e) => !isAfterRunFinished(e)), after: [] }]
      : [];

  return [...finished, ...open];
}

export function taskReport(events, taskId) {
  return { task: taskId, runs: taskRuns(events, taskId).map(runReport) };
}

function costByRole(roleEvents) {
  const groups = groupBy(roleEvents, (e) => e.role);

  return Object.fromEntries(
    [...groups].map(([role, group]) => [
      role,
      {
        runs: group.filter((e) => !e.afterRunFinished).length,
        tasks: new Set(group.map((e) => e.task)).size,
        ...costTotal(group),
      },
    ])
  );
}

if (isMain(import.meta.url)) {
  const [taskId] = process.argv.slice(2);
  printJson(taskId ? taskReport(readEvents(), taskId) : summarize(readEvents()));
}

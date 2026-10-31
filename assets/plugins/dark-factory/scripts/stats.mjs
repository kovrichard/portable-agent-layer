import { isMain, printJson, readEvents } from "./lib.mjs";

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

export function runsOf(events) {
  const runs = [];
  const open = new Map();
  for (const event of events) {
    if (event.event === "task_started") {
      open.set(event.task, { task: event.task, events: [event] });
      continue;
    }
    const run = open.get(event.task);
    if (!run) continue;
    run.events.push(event);
    if (event.event === "run_finished") {
      runs.push({ task: run.task, finishedAt: event.ts, events: run.events });
      open.delete(event.task);
    }
  }
  return runs;
}

export function metricOver(name, runs) {
  if (!Object.hasOwn(METRICS, name)) throw new Error(`unknown metric "${name}"`);
  if (runs.length === 0) return null;
  const values = runs.map((run) => METRICS[name](run.events));
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

if (isMain(import.meta.url)) printJson(summarize(readEvents()));

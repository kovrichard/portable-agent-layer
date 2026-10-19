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

if (isMain(import.meta.url)) printJson(summarize(readEvents()));

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { factoryHome } from "./lib.mjs";

const PATH_LINE = /^(?:---|\+\+\+) [ab]\/(.+)$/;
const DECLARATION = /\b(?:function\*?|class|const|let|var|def|fn)\s+([A-Za-z_$][\w$]*)/g;
const ASSIGNED_FUNCTION =
  /\b([A-Za-z_$][\w$]*)\s*[=:]\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g;
const MIN_BASENAME_LENGTH = 3;
const MIN_IDENTIFIER_LENGTH = 3;

export function findingsFile(env = process.env) {
  return join(factoryHome(env), "coach", "findings.jsonl");
}

export function readFindings(env = process.env) {
  const file = findingsFile(env);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function writeFindings(findings, env = process.env) {
  const file = findingsFile(env);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(
    temporary,
    findings.map((finding) => `${JSON.stringify(finding)}\n`).join("")
  );
  renameSync(temporary, file);
}

const LOCK_POLL_MS = 50;
const LOCK_STALE_MS = 60000;
const LOCK_TIMEOUT_MS = 30000;

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeIfStale(lock) {
  try {
    if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS)
      rmSync(lock, { force: true });
  } catch {}
}

function acquire(lock) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      writeFileSync(lock, String(process.pid), { flag: "wx" });
      return;
    } catch (error) {
      if (error.code !== "EEXIST" || Date.now() > deadline) throw error;
      removeIfStale(lock);
      pause(LOCK_POLL_MS);
    }
  }
}

export function withFindingsLock(env, action) {
  const lock = join(dirname(findingsFile(env)), "findings.lock");
  mkdirSync(dirname(lock), { recursive: true });
  acquire(lock);
  try {
    return action();
  } finally {
    rmSync(lock, { force: true });
  }
}

function isDistinctiveIdentifier(name) {
  return (
    name.length >= MIN_IDENTIFIER_LENGTH &&
    (/.[A-Z]/.test(name) || name.includes("_") || /\d/.test(name))
  );
}

function pathNames(line) {
  const match = PATH_LINE.exec(line);
  if (!match) return [];
  const path = match[1];
  const base = path.split("/").at(-1);
  return base.length >= MIN_BASENAME_LENGTH ? [path, base] : [path];
}

function identifiersIn(line) {
  if (!line.startsWith("+") || line.startsWith("+++")) return [];
  return [DECLARATION, ASSIGNED_FUNCTION].flatMap((pattern) =>
    Array.from(line.matchAll(pattern), (match) => match[1])
  );
}

function namesOfLine(line) {
  return [...pathNames(line), ...identifiersIn(line).filter(isDistinctiveIdentifier)];
}

export function diffNames(diffText) {
  return [...new Set(diffText.split("\n").flatMap(namesOfLine))];
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ruleMentions(rule, name) {
  if (name.includes("/") || name.includes(".")) return rule.includes(name);
  return new RegExp(`(^|[^\\w$])${escapeRegExp(name)}([^\\w$]|$)`).test(rule);
}

export function generalityViolation(rule, names) {
  return names.find((name) => ruleMentions(rule, name)) ?? null;
}

function classKey(role, cls) {
  return `${role}::${cls.trim().toLowerCase()}`;
}

function mergeEvidence(existing = [], added = []) {
  const seen = new Set();
  return [...existing, ...added].filter((item) => {
    const key = `${item.task}\u0000${item.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeInto(finding, added, stamp) {
  finding.evidence = mergeEvidence(finding.evidence, added);
  finding.updatedAt = stamp;
}

function addOnce(list, value) {
  if (!list.includes(value)) list.push(value);
}

function newFinding(result, id, stamp) {
  return {
    id,
    status: "pending",
    createdAt: stamp,
    updatedAt: stamp,
    class: result.class,
    role: result.role,
    rule: result.rule,
    severity: result.severity,
    metric: result.metric,
    elsewhere: result.elsewhere,
    evidence: result.evidence,
  };
}

function droppedEvent(taskId, result, rejected) {
  return {
    event: "coach_finding_dropped",
    task: taskId,
    role: result.role,
    class: result.class,
    reason: "rejected",
    rejectedId: rejected.id,
  };
}

function applyFinding(state, result, { taskId, names, stamp }) {
  const key = classKey(result.role, result.class);
  const matched = generalityViolation(result.rule, names);
  if (matched) {
    state.events.push({
      event: "coach_rule_rejected",
      task: taskId,
      role: result.role,
      class: result.class,
      matched,
    });
    return;
  }
  const sameClass = (finding) => classKey(finding.role, finding.class) === key;
  const rejected = state.store.find(
    (finding) => finding.status === "rejected" && sameClass(finding)
  );
  if (rejected) {
    state.events.push(droppedEvent(taskId, result, rejected));
    return;
  }
  const pending = state.store.find(
    (finding) => finding.status === "pending" && sameClass(finding)
  );
  if (pending) {
    mergeInto(pending, result.evidence, stamp);
    addOnce(state.updated, pending.id);
    return;
  }
  const finding = newFinding(result, `c${state.store.length + 1}`, stamp);
  state.store.push(finding);
  state.created.push(finding.id);
}

function applyUpdate(state, update, { taskId, stamp }) {
  const target = state.store.find(
    (finding) => finding.id === update.id && finding.status === "pending"
  );
  if (target) {
    mergeInto(target, update.evidence, stamp);
    addOnce(state.updated, target.id);
    return;
  }
  state.events.push({ event: "coach_update_ignored", task: taskId, id: update.id });
}

export function applyCoachResult(store, result, { taskId, names, now }) {
  const stamp = now.toISOString();
  const state = {
    store: store.map((finding) => ({ ...finding })),
    events: [],
    created: [],
    updated: [],
  };
  for (const finding of result.findings)
    applyFinding(state, finding, { taskId, names, stamp });
  for (const update of result.updates) applyUpdate(state, update, { taskId, stamp });
  return state;
}

export function findingById(id, env = process.env) {
  const finding = readFindings(env).find((item) => item.id === id);
  if (!finding) throw new Error(`unknown finding "${id}"`);
  return finding;
}

function transitionPending(id, changes, env, now) {
  return withFindingsLock(env, () => transitionPendingLocked(id, changes, env, now));
}

function transitionPendingLocked(id, changes, env, now) {
  const store = readFindings(env);
  const index = store.findIndex((finding) => finding.id === id);
  if (index === -1) throw new Error(`unknown finding "${id}"`);
  const current = store[index];
  if (current.status !== "pending")
    throw new Error(`finding ${id} is ${current.status}, not pending`);
  const updated = { ...current, ...changes, updatedAt: now.toISOString() };
  store[index] = updated;
  writeFindings(store, env);
  return updated;
}

export function rejectFinding(id, reason, env = process.env, now = new Date()) {
  return transitionPending(id, { status: "rejected", rejectReason: reason }, env, now);
}

export function markApproved(id, taskId, env = process.env, now = new Date()) {
  return transitionPending(
    id,
    { status: "approved", taskId, approvedAt: now.toISOString() },
    env,
    now
  );
}

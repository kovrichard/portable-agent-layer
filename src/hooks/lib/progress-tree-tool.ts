/**
 * A PR the session opened with `gh pr create`, and a dark-factory build it started, land on its active node without being recorded by hand.
 */

import { normalizeToolUse } from "./agent";
import { hookSessionId } from "./hook-turn";
import { unappliedVerdictOf } from "./ledger-hook";
import { progressSession } from "./progress-session";
import {
  type ArtifactKind,
  attachOnce,
  readTree,
  scopeOf,
  type WorkNode,
} from "./progress-tree";
import { openSessionNode } from "./progress-tree-session-node";
import { sessionDir } from "./session-dir";
import { isOptedIn } from "./settings";
import { COMMAND_KEYS, resultOf, stringIn } from "./tool-events";

const GH_PR_CREATE_RE = /\bgh\s+pr\s+create\b/;
const PR_URL_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
const FACTORY_BUILD_RE =
  /\b(?:node|bun)(?:\.exe)?\s+(?:run\s+)?["']?\S*\bdark-factory[\\/](?:\S*[\\/])?scripts[\\/]build\.mjs["']?\s+["']?(\w[\w.-]*)/;
const FACTORY_RUN_PREFIX = "dark-factory:";
const OUTPUT_KEYS = [
  "stdout",
  "output",
  "textResultForLlm",
  "aggregated_output",
  "content",
];
const EXIT_KEYS = ["exit_code", "exitCode", "exit"];

interface Artifact {
  kind: ArtifactKind;
  ref: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsedJsonObject(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "string" ? parsedJsonObject(value) : asRecord(value);
}

function toolOutputText(payload: Record<string, unknown>): string {
  const result = resultOf(payload);
  const record = recordOf(result);
  if (record) return stringIn(record, OUTPUT_KEYS) ?? "";
  return typeof result === "string" ? result : "";
}

function exitCodeOf(source: unknown): number | null {
  const record = recordOf(source);
  const code = EXIT_KEYS.map((k) => record?.[k]).find((v) => typeof v === "number");
  return (code as number | undefined) ?? null;
}

function failedExit(source: unknown): boolean {
  const code = exitCodeOf(source);
  return code !== null && code !== 0;
}

function callFailed(payload: Record<string, unknown>): boolean {
  const result = recordOf(resultOf(payload));
  return (
    unappliedVerdictOf(payload) !== null ||
    (typeof payload.error === "string" && payload.error !== "") ||
    result?.resultType === "failure" ||
    result?.interrupted === true ||
    failedExit(payload) ||
    failedExit(resultOf(payload))
  );
}

function callDenied(payload: Record<string, unknown>): boolean {
  return unappliedVerdictOf(payload)?.outcome === "denied";
}

function commandOf(payload: Record<string, unknown>): string | null {
  const call = normalizeToolUse(payload);
  return call ? stringIn(call.toolInput, COMMAND_KEYS) : null;
}

function createdPrUrl(command: string, output: string): string | null {
  if (!GH_PR_CREATE_RE.test(command)) return null;
  return Array.from(output.matchAll(PR_URL_RE), (m) => m[0]).at(-1) ?? null;
}

function startedFactoryTask(command: string): string | null {
  return FACTORY_BUILD_RE.exec(command)?.[1] ?? null;
}

function sessionNodeFor(
  scope: string,
  session: string | undefined,
  file: string | undefined,
  now: Date
): WorkNode | undefined {
  const tree = readTree(scope, file, session);
  if (tree.active) return tree.nodes.get(tree.active);
  const id = openSessionNode(scope, session, file, now);
  return readTree(scope, file, session).nodes.get(id);
}

function attachToSessionNode(
  cwd: string,
  session: string | undefined,
  artifact: Artifact,
  file: string | undefined,
  now: Date
): void {
  const scope = scopeOf(cwd);
  const node = sessionNodeFor(scope, session, file, now);
  if (node) attachOnce(scope, node, artifact, file, now, session);
}

export function attachProgressFromToolCall(
  payload: Record<string, unknown>,
  cwd: string = sessionDir(),
  file?: string,
  now: Date = new Date()
): void {
  try {
    if (!isOptedIn("progressTree")) return;
    const command = commandOf(payload);
    if (!command || callDenied(payload)) return;
    const session = progressSession(hookSessionId(payload));
    const task = startedFactoryTask(command);
    if (task)
      attachToSessionNode(
        cwd,
        session,
        { kind: "run", ref: `${FACTORY_RUN_PREFIX}${task}` },
        file,
        now
      );
    const url = callFailed(payload)
      ? null
      : createdPrUrl(command, toolOutputText(payload));
    if (url) attachToSessionNode(cwd, session, { kind: "pr", ref: url }, file, now);
  } catch {
    return;
  }
}

/**
 * What the two ledger hooks agree on: which tool calls are worth recording, and
 * how to find the file and the call id in an agent's payload.
 *
 * Both halves must answer these identically — a pre-tool half that snapshots a
 * tool the post-tool half ignores leaves a snapshot nothing ever claims.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { normalizeToolUse } from "./agent";
import {
  claimPending,
  type LedgerEntry,
  type LedgerOutcome,
  reapStalePending,
  recordAction,
  savePending,
} from "./ledger";

/**
 * Edits and writes, which carry their own target in the call. A shell command's
 * effect is not derivable from its arguments, so recording one honestly needs a
 * different mechanism than reading the path out of the payload.
 *
 * Reads and searches are excluded because they are queries, not actions, and a
 * ledger that logs them buries the changes among them.
 *
 * The four beyond edit and write are Copilot's own names for the same act — its
 * runtime groups them as its file-editing tools, and it sends the command as
 * the tool name rather than as an argument.
 */
const LEDGERED_TOOLS = new Set([
  "edit",
  "write",
  "create",
  "insert",
  "str_replace",
  "str_replace_editor",
]);

/**
 * Copilot's CLI also writes through a patch, and one call of that edits however
 * many files the patch names. Its targets live in the patch body rather than in
 * an argument, so it is filtered separately and read by patchedTargets.
 */
const PATCHING_TOOLS = new Set(["apply_patch", "applypatch"]);

/**
 * The editor tool that changes a file also reads one, under a command argument.
 * A read recorded as an action would put queries back in a log of changes.
 */
const READING_COMMANDS = new Set(["view"]);

/** Agents disagree on the spelling; the value is the same file either way. */
const TARGET_KEYS = ["file_path", "filePath", "path"];

/** Every header in the V4A patch format that names a file the patch changes. */
const PATCHED_FILE_HEADER = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;

export interface LedgeredCall {
  toolUseId: string;
  tool: string;
  target: string;
}

/**
 * The one reading of a payload both halves share. Asking the same question in
 * two places is how they drift apart, and a drift here is silent: the pre-tool
 * half parks a snapshot the post-tool half never comes to claim.
 *
 * A list because a patch call changes a set of files, not one.
 */
export function ledgeredCalls(payload: Record<string, unknown>): LedgeredCall[] {
  const toolUse = normalizeToolUse(payload);
  if (!toolUse) return [];

  const patched = patchedTargets(payload, toolUse.toolName);
  if (patched.length > 0) return patchCalls(payload, toolUse.toolName, patched);

  const target = ledgeredTarget(toolUse.toolName, toolUse.toolInput);
  if (!target) return [];

  const toolUseId = pairingKeyOf(payload, toolUse.toolName, target);
  return toolUseId ? [{ toolUseId, tool: toolUse.toolName, target }] : [];
}

/**
 * A patch changes several files under one tool call, so the call's own id
 * cannot key its snapshots — all of them would collide on it and only one would
 * ever be claimed. Naming the target in the key is what keeps them apart.
 */
function patchCalls(
  payload: Record<string, unknown>,
  tool: string,
  targets: string[]
): LedgeredCall[] {
  const anchor = toolUseIdOf(payload) ?? sessionOf(payload);
  if (!anchor) return [];
  return targets.map((target) => ({
    toolUseId: derivedPairingKey(anchor, tool, target),
    tool,
    target,
  }));
}

/**
 * The files a patch call changes, resolved against the directory the agent ran
 * it in — a patch names them the way the agent typed them, which is relative.
 */
function patchedTargets(payload: Record<string, unknown>, toolName: string): string[] {
  if (!PATCHING_TOOLS.has(toolName.toLowerCase())) return [];

  const patch = patchBodyOf(payload);
  if (!patch) return [];

  const base = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
  return Array.from(patch.matchAll(PATCHED_FILE_HEADER), (match) =>
    absoluteFrom(base, match[1].trim())
  );
}

/** Its arguments are the patch itself, rather than JSON naming a file. */
function patchBodyOf(payload: Record<string, unknown>): string | null {
  const args = payload.toolArgs ?? payload.tool_input ?? payload.toolInput;
  if (typeof args === "string") return args.length > 0 ? args : null;
  return patchCommandOf(args);
}

/** Codex carries the patch under a command key instead of sending it as the arguments. */
function patchCommandOf(args: unknown): string | null {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return null;
  const command = (args as Record<string, unknown>).command;
  return typeof command === "string" && command.length > 0 ? command : null;
}

function absoluteFrom(base: string, path: string): string {
  return isAbsolute(path) ? path : resolve(base, path);
}

/**
 * Copilot's CLI publishes no id for a tool invocation, so its two halves are
 * paired on what both do carry. Session, tool and target identify the call
 * uniquely as long as it does not overlap another write to the same file in
 * the same session, which sequential tool use cannot produce.
 */
function derivedPairingKey(anchor: string, tool: string, target: string): string {
  const digest = new Bun.CryptoHasher("sha256")
    .update([anchor, tool, target].join(" "), "utf-8")
    .digest("hex");
  return `derived-${digest.slice(0, 32)}`;
}

function sessionOf(payload: Record<string, unknown>): string | null {
  const session = payload.sessionId ?? payload.session_id;
  return typeof session === "string" && session.length > 0 ? session : null;
}

function pairingKeyOf(
  payload: Record<string, unknown>,
  tool: string,
  target: string
): string | null {
  const explicit = toolUseIdOf(payload);
  if (explicit) return explicit;

  const session = sessionOf(payload);
  return session ? derivedPairingKey(session, tool, target) : null;
}

/**
 * How a call that did not land reports itself. Two events, because the runtime
 * treats the two endings as different things and so does the ledger: a tool
 * that ran and errored is not a call something refused to run.
 *
 * They carry the same fact under different keys, which is the whole reason this
 * mapping is written down in one place rather than read twice.
 */
const UNAPPLIED_EVENTS: Record<string, { outcome: LedgerOutcome; reasonKeys: string[] }> =
  {
    PostToolUseFailure: { outcome: "failed", reasonKeys: ["error"] },
    PermissionDenied: { outcome: "denied", reasonKeys: ["reason"] },
    postToolUseFailure: { outcome: "failed", reasonKeys: ["error_message", "error"] },
  };

function deniedByFailureType(payload: Record<string, unknown>): boolean {
  return payload.failure_type === "permission_denied";
}

export interface UnappliedVerdict {
  outcome: LedgerOutcome;
  reason?: string;
}

/** Copilot names the event nowhere in its payload, so its config says so on argv. */
function eventFromArgv(): string | undefined {
  const flag = process.argv.find((a) => a.startsWith("--event="));
  return flag?.slice("--event=".length) || undefined;
}

/**
 * What became of a call, for the events that mean it did not land — or nothing
 * when the payload is some other event, so one hook can be registered on both
 * without having to be told which one it is being run for.
 */
export function unappliedVerdictOf(
  payload: Record<string, unknown>
): UnappliedVerdict | null {
  const event = payload.hook_event_name ?? payload.hookEventName ?? eventFromArgv();
  if (typeof event !== "string") return null;

  const mapping = UNAPPLIED_EVENTS[event];
  if (!mapping) return null;

  const outcome = deniedByFailureType(payload) ? "denied" : mapping.outcome;
  const reason = mapping.reasonKeys
    .map((key) => payload[key])
    .find((value): value is string => typeof value === "string" && value.length > 0);
  return reason ? { outcome, reason } : { outcome };
}

function contentsOf(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

/** Park the target's current contents, the last moment they still exist. */
export function snapshotCall(call: LedgeredCall): void {
  savePending({ ...call, before: contentsOf(call.target), ts: new Date().toISOString() });
}

/** Pair a parked before-state with the result, or nothing if none was parked. */
export function commitApplied(call: LedgeredCall): LedgerEntry | null {
  const pending = claimPending(call.toolUseId);
  if (!pending) return null;

  const entry = recordAction({
    tool: pending.tool,
    target: pending.target,
    outcome: "applied",
    before: pending.before,
    beforeState: pending.beforeState,
    after: contentsOf(call.target),
  });
  reapStalePending();
  return entry;
}

export function toolUseIdOf(payload: Record<string, unknown>): string | null {
  for (const key of ["tool_use_id", "toolUseId", "tool_call_id"]) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function readsRatherThanChanges(toolInput: Record<string, unknown>): boolean {
  const command = toolInput.command;
  return typeof command === "string" && READING_COMMANDS.has(command);
}

/**
 * The absolute path this call will change, or nothing if the call is not one
 * the ledger records.
 */
export function ledgeredTarget(
  toolName: string,
  toolInput: Record<string, unknown>
): string | null {
  if (!LEDGERED_TOOLS.has(toolName.toLowerCase())) return null;
  if (readsRatherThanChanges(toolInput)) return null;
  for (const key of TARGET_KEYS) {
    const value = toolInput[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

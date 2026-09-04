/**
 * What the two ledger hooks agree on: which tool calls are worth recording, and
 * how to find the file and the call id in an agent's payload.
 *
 * Both halves must answer these identically — a pre-tool half that snapshots a
 * tool the post-tool half ignores leaves a snapshot nothing ever claims.
 */

import { normalizeToolUse } from "./agent";
import type { LedgerOutcome } from "./ledger";

/**
 * Edits and writes, which carry their own target in the call. A shell command's
 * effect is not derivable from its arguments, so recording one honestly needs a
 * different mechanism than reading the path out of the payload.
 *
 * Reads and searches are excluded because they are queries, not actions, and a
 * ledger that logs them buries the changes among them.
 */
const LEDGERED_TOOLS = new Set(["edit", "write"]);

/** Agents disagree on the spelling; the value is the same file either way. */
const TARGET_KEYS = ["file_path", "filePath", "path"];

export interface LedgeredCall {
  toolUseId: string;
  tool: string;
  target: string;
}

/**
 * The one reading of a payload both halves share. Asking the same question in
 * two places is how they drift apart, and a drift here is silent: the pre-tool
 * half parks a snapshot the post-tool half never comes to claim.
 */
export function ledgeredCall(payload: Record<string, unknown>): LedgeredCall | null {
  const toolUse = normalizeToolUse(payload);
  const toolUseId = toolUseIdOf(payload);
  if (!toolUse || !toolUseId) return null;

  const target = ledgeredTarget(toolUse.toolName, toolUse.toolInput);
  return target ? { toolUseId, tool: toolUse.toolName, target } : null;
}

/**
 * How a call that did not land reports itself. Two events, because the runtime
 * treats the two endings as different things and so does the ledger: a tool
 * that ran and errored is not a call something refused to run.
 *
 * They carry the same fact under different keys, which is the whole reason this
 * mapping is written down in one place rather than read twice.
 */
const UNAPPLIED_EVENTS: Record<string, { outcome: LedgerOutcome; reasonKey: string }> = {
  PostToolUseFailure: { outcome: "failed", reasonKey: "error" },
  PermissionDenied: { outcome: "denied", reasonKey: "reason" },
};

export interface UnappliedVerdict {
  outcome: LedgerOutcome;
  reason?: string;
}

/**
 * What became of a call, for the events that mean it did not land — or nothing
 * when the payload is some other event, so one hook can be registered on both
 * without having to be told which one it is being run for.
 */
export function unappliedVerdictOf(
  payload: Record<string, unknown>
): UnappliedVerdict | null {
  const event = payload.hook_event_name ?? payload.hookEventName;
  if (typeof event !== "string") return null;

  const mapping = UNAPPLIED_EVENTS[event];
  if (!mapping) return null;

  const reason = payload[mapping.reasonKey];
  // A reason the runtime did not send is left absent rather than invented: an
  // entry that states a cause it does not have is worse than one that admits none.
  return typeof reason === "string" && reason.length > 0
    ? { outcome: mapping.outcome, reason }
    : { outcome: mapping.outcome };
}

export function toolUseIdOf(payload: Record<string, unknown>): string | null {
  for (const key of ["tool_use_id", "toolUseId", "tool_call_id"]) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
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
  for (const key of TARGET_KEYS) {
    const value = toolInput[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

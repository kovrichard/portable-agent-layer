/**
 * Everything PAL does once a tool call has ended: the tool_call event, and the
 * ledger's second half. A failure or a denial is recorded as unapplied, anything
 * else as applied.
 *
 * Not every attempt that fails to land reaches here. A manual denial at the
 * permission dialog, a `deny` rule and a PreToolUse block fire nothing after
 * PreToolUse, and a schema rejection fires no hook at all; the reaper in
 * ledger.ts claims the snapshots those leave behind.
 */

import { reapStalePending } from "./ledger";
import {
  commitApplied,
  commitUnapplied,
  landedCalls,
  ledgeredCalls,
  type UnappliedVerdict,
  unappliedVerdictOf,
} from "./ledger-hook";
import { logDebug } from "./log";
import { attachProgressFromToolCall } from "./progress-tree-tool";
import { logToolCall } from "./tool-events";

type Payload = Record<string, unknown>;

function recordApplied(payload: Payload): void {
  for (const call of landedCalls(payload)) {
    const entry = commitApplied(call);
    if (entry) logDebug("post-tool", `applied ${entry.id} ${entry.tool} ${entry.target}`);
  }
}

function recordUnapplied(payload: Payload, verdict: UnappliedVerdict): void {
  const calls = ledgeredCalls(payload);
  if (calls.length === 0) return;
  for (const call of calls) {
    const entry = commitUnapplied(call, verdict);
    logDebug("post-tool", `${entry.outcome} ${entry.id} ${entry.target}`);
  }
  reapStalePending();
}

function recordInLedger(payload: Payload): void {
  const verdict = unappliedVerdictOf(payload);
  if (verdict) recordUnapplied(payload, verdict);
  else recordApplied(payload);
}

const HANDLERS: Record<string, (payload: Payload) => void> = {
  events: logToolCall,
  ledger: recordInLedger,
  "progress-tree": (payload) => attachProgressFromToolCall(payload),
};

/**
 * Runs every handler, or the one an `--only=<name>` registration asks for:
 * Claude Code runs the ledger sync on edits and the events async on every tool.
 */
export function runPostToolHandlers(
  payload: Payload,
  argv: string[] = process.argv
): void {
  const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  for (const [name, handle] of Object.entries(HANDLERS)) {
    if (!only || only === name) handle(payload);
  }
}

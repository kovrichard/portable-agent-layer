/**
 * One event per tool call, on every agent: which tool, how it ended, and the
 * cheap facts about it. The call's arguments go to the content store.
 */

import { basename, extname } from "node:path";
import { FILE_TARGET_KEYS, normalizeToolUse, type ToolUseRequest } from "./agent";
import { appendEvent, logQuietly } from "./events";
import { hookSessionId } from "./hook-turn";
import { unappliedVerdictOf } from "./ledger-hook";
import { isPalSpawnedInference } from "./spawn-guard";
import { permissionWaitSec } from "./waiting-on-user";

const RESULT_KEYS = ["tool_response", "toolResult", "tool_output", "result"];
const DURATION_KEYS = ["duration_ms", "durationMs"];
const COMMAND_KEYS = ["command", "commandLine", "CommandLine", "script"];

function stringIn(input: Record<string, unknown>, keys: string[]): string | null {
  const found = keys.map((k) => input[k]).find((v) => typeof v === "string" && v);
  return (found as string | undefined) ?? null;
}

function numberIn(source: unknown, keys: string[]): number | null {
  if (typeof source !== "object" || source === null) return null;
  const record = source as Record<string, unknown>;
  const found = keys.map((k) => record[k]).find((v) => typeof v === "number");
  return (found as number | undefined) ?? null;
}

function resultOf(payload: Record<string, unknown>): unknown {
  return RESULT_KEYS.map((k) => payload[k]).find((v) => v !== undefined);
}

function sizeOf(value: unknown): number {
  if (value === undefined || value === null) return 0;
  return typeof value === "string" ? value.length : JSON.stringify(value).length;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function mcpServerOf(tool: string): string | null {
  return tool.startsWith("mcp__") ? (tool.split("__")[1] ?? null) : null;
}

function programOf(command: string | null): string | null {
  const first = command?.trim().split(/\s+/)[0];
  return first ? basename(first) : null;
}

function outcomeOf(payload: Record<string, unknown>): string {
  const verdict = unappliedVerdictOf(payload);
  if (verdict) return verdict.outcome;
  return typeof payload.error === "string" && payload.error ? "failed" : "ok";
}

function subagentRun(result: unknown) {
  return {
    subagentTokens: numberIn(result, ["totalTokens"]),
    subagentTools: numberIn(result, ["totalToolUseCount"]),
  };
}

function toolCallFields(payload: Record<string, unknown>, call: ToolUseRequest) {
  const input = call.toolInput;
  const result = resultOf(payload);
  const file = stringIn(input, FILE_TARGET_KEYS);
  return {
    tool: call.toolName,
    outcome: outcomeOf(payload),
    durationMs: numberIn(payload, DURATION_KEYS) ?? numberIn(result, ["totalDurationMs"]),
    inputChars: sizeOf(input),
    outputChars: sizeOf(result),
    fileExt: file ? extname(file) || null : null,
    program: programOf(stringIn(input, COMMAND_KEYS)),
    skill: stringIn(input, ["skill"]),
    subagent: stringIn(input, ["subagent_type"]),
    ...subagentRun(result),
    mcpServer: mcpServerOf(call.toolName),
    host: hostOf(stringIn(input, ["url"])),
  };
}

/** Logs the call a post-tool, failure or denial payload describes; ignores anything else. */
export function logToolCall(payload: Record<string, unknown> | null): void {
  if (isPalSpawnedInference()) return;
  logQuietly("tool_call", () => {
    const call = normalizeToolUse(payload);
    if (!payload || !call) return;
    const session = hookSessionId(payload) ?? null;
    const fields = {
      ...toolCallFields(payload, call),
      promptWaitSec: permissionWaitSec(session, call.toolName),
    };
    appendEvent("tool_call", fields, {
      session,
      content: { tool: call.toolName, input: call.toolInput },
    });
  });
}

const FOLDED_FLAG = "--tool-events";

/**
 * Where a ledger hook already runs after every tool call, it logs the call too
 * and saves a process. The install template opts in with the flag; Claude Code
 * matches its ledger hooks to edits alone and runs ToolEvent async instead.
 */
export function logToolCallWhenFolded(
  payload: Record<string, unknown> | null,
  argv: string[] = process.argv
): void {
  if (argv.includes(FOLDED_FLAG)) logToolCall(payload);
}

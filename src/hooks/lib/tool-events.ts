/**
 * One event per tool call, on every agent: which tool, how it ended, and the
 * cheap facts about it. The call's arguments go to the content store.
 */

import { basename, extname } from "node:path";
import { appendEvent, logQuietly } from "../../bronze/events";
import { unappliedVerdictOf } from "../../bronze/ledger-hook";
import { isSensitivePath } from "../../bronze/sensitive-path";
import { appendToolOutput, type ToolOutputRow } from "../../bronze/tool-output";
import {
  FILE_TARGET_KEYS,
  normalizeToolUse,
  type ToolUseRequest,
} from "../../core/agent";
import { hookSessionId } from "../../core/hook-payload";
import { isPalSpawnedInference } from "../../core/spawn-guard";
import { permissionWaitSec } from "./waiting-on-user";

const RESULT_KEYS = ["tool_response", "toolResult", "tool_output", "result"];
const DURATION_KEYS = ["duration_ms", "durationMs"];
export const COMMAND_KEYS = ["command", "commandLine", "CommandLine", "script"];

export function stringIn(input: Record<string, unknown>, keys: string[]): string | null {
  const found = keys.map((k) => input[k]).find((v) => typeof v === "string" && v);

  return (found as string | undefined) ?? null;
}

function numberIn(source: unknown, keys: string[]): number | null {
  if (typeof source !== "object" || source === null) return null;
  const record = source as Record<string, unknown>;
  const found = keys.map((k) => record[k]).find((v) => typeof v === "number");

  return (found as number | undefined) ?? null;
}

export function resultOf(payload: Record<string, unknown>): unknown {
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

function outputUnlessSensitive(
  call: ToolUseRequest,
  output: unknown
): Pick<ToolOutputRow, "output" | "withheld"> {
  const file = stringIn(call.toolInput, FILE_TARGET_KEYS);

  return file && isSensitivePath(file) ? { output: null, withheld: true } : { output };
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
    const ts = new Date().toISOString();
    const id = appendEvent("tool_call", fields, {
      ts,
      session,
      content: { tool: call.toolName, input: call.toolInput },
    });
    const output = resultOf(payload);
    if (id && output !== undefined)
      appendToolOutput({
        id,
        ts,
        tool: call.toolName,
        ...outputUnlessSensitive(call, output),
      });
  });
}

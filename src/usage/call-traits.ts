import { basename, extname } from "node:path";
import { FILE_TARGET_KEYS, type ToolUseRequest } from "../core/agent";

export const COMMAND_KEYS = ["command", "commandLine", "CommandLine", "script"];

export function stringIn(input: Record<string, unknown>, keys: string[]): string | null {
  const found = keys.map((k) => input[k]).find((v) => typeof v === "string" && v);

  return (found as string | undefined) ?? null;
}

export function sizeOf(value: unknown): number {
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

/** What a call's name and arguments say about it, whether it ran or not. */
export function callTraits(call: ToolUseRequest) {
  const input = call.toolInput;
  const file = stringIn(input, FILE_TARGET_KEYS);

  return {
    tool: call.toolName,
    inputChars: sizeOf(input),
    fileExt: file ? extname(file) || null : null,
    program: programOf(stringIn(input, COMMAND_KEYS)),
    skill: stringIn(input, ["skill"]),
    subagent: stringIn(input, ["subagent_type"]),
    mcpServer: mcpServerOf(call.toolName),
    host: hostOf(stringIn(input, ["url"])),
  };
}

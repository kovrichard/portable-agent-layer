/**
 * The tool calls one turn made and the output they returned, read from the raw lines
 * of a Claude Code transcript: `tool_use` blocks in assistant entries, `tool_result`
 * blocks and `toolUseResult` in the user entries that answer them.
 */

import { isPromptLine } from "../opinions/claim-check";

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface TurnTools {
  calls: ToolCall[];
  outputs: string[];
}

interface Block {
  type?: string;
  name?: string;
  input?: unknown;
  text?: unknown;
  content?: unknown;
}

interface Entry {
  type?: string;
  isSidechain?: boolean;
  message?: { content?: unknown };
  toolUseResult?: unknown;
}

function parsed(line: string): Entry | null {
  try {
    const entry = JSON.parse(line);

    return entry && typeof entry === "object" ? entry : null;
  } catch {
    return null;
  }
}

function blocksOf(entry: Entry): Block[] {
  const content = entry.message?.content;

  return Array.isArray(content) ? content : [];
}

function inputOf(block: Block): Record<string, unknown> {
  return block.input && typeof block.input === "object"
    ? (block.input as Record<string, unknown>)
    : {};
}

function callsOf(entry: Entry): ToolCall[] {
  return blocksOf(entry)
    .filter((b) => b.type === "tool_use" && typeof b.name === "string")
    .map((b) => ({ name: b.name as string, input: inputOf(b) }));
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;

  return Array.isArray(content)
    ? content.map((part) => resultText(part?.text)).join("\n")
    : "";
}

function outputsOf(entry: Entry): string[] {
  const results = blocksOf(entry)
    .filter((b) => b.type === "tool_result")
    .map((b) => resultText(b.content));
  const structured = entry.toolUseResult ? [JSON.stringify(entry.toolUseResult)] : [];

  return [...results, ...structured];
}

function isClaudeCodeEntry(entry: Entry): boolean {
  return entry.type === "user" || entry.type === "assistant";
}

/** Null when no line is a Claude Code entry, so an unreadable transcript never reads as a turn without tools. */
export function turnTools(lines: readonly string[]): TurnTools | null {
  let tools: TurnTools = { calls: [], outputs: [] };
  let readable = false;

  for (const line of lines) {
    const entry = parsed(line);
    if (!entry || !isClaudeCodeEntry(entry) || entry.isSidechain) continue;
    readable = true;

    if (isPromptLine(line)) tools = { calls: [], outputs: [] };
    tools.calls.push(...callsOf(entry));
    tools.outputs.push(...outputsOf(entry));
  }

  return readable ? tools : null;
}

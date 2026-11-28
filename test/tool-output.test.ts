import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectExportFiles } from "../src/core/export";
import { reload } from "../src/core/settings";
import { SPAWN_GUARD_ENV } from "../src/core/spawn-guard";
import { logToolCall } from "../src/usage/tool-events";
import { freshTestDir } from "./lib/test-home";

let home: string;

function month(): string {
  return new Date().toISOString().slice(0, 7);
}

function rowsIn(...dir: string[]): Record<string, unknown>[] {
  const file = resolve(home, "records", "bronze", ...dir, `${month()}.jsonl`);
  if (!existsSync(file)) return [];

  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

const toolCalls = () => rowsIn("events").filter((e) => e.type === "tool_call");
const outputs = () => rowsIn("tool-output");
const eventText = () => rowsIn("event-text");

function readCall(
  response: unknown,
  filePath = "/work/notes.md"
): Record<string, unknown> {
  return {
    hook_event_name: "PostToolUse",
    session_id: "s1",
    tool_name: "Read",
    tool_input: { file_path: filePath },
    tool_response: response,
  };
}

beforeEach(() => {
  delete process.env[SPAWN_GUARD_ENV.SENTINEL];
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("the text a tool returns", () => {
  test("a string result is stored whole under the id and time of its tool_call event", () => {
    const text = "line one\n\tline two ✓\n";
    logToolCall(readCall(text));
    const [event] = toolCalls();

    expect(outputs()).toEqual([
      { id: event?.id, ts: event?.ts, tool: "Read", output: text },
    ]);
  });

  test("an object result is stored as the same object", () => {
    const response = { stdout: "ok\n", stderr: "", interrupted: false, isImage: false };
    logToolCall({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "echo ok" },
      tool_response: response,
    });

    expect(outputs()).toEqual([
      { id: toolCalls()[0]?.id, ts: toolCalls()[0]?.ts, tool: "Bash", output: response },
    ]);
  });

  test("a payload with no result writes no row and still logs the event", () => {
    logToolCall({ session_id: "s1", tool_name: "Grep", tool_input: {} });

    expect(toolCalls()).toHaveLength(1);
    expect(existsSync(resolve(home, "records", "bronze", "tool-output"))).toBe(false);
  });

  test("a result of 700,000 characters is stored whole", () => {
    const text = "x".repeat(699_999).concat("y");
    logToolCall(readCall(text));

    expect(outputs()[0]?.output).toBe(text);
  });

  test("the event's outputChars equals the size of what was stored", () => {
    logToolCall(readCall("four"));
    logToolCall(readCall({ type: "text", file: { content: "abc" } }));
    const stored = outputs().map((row) =>
      typeof row.output === "string"
        ? row.output.length
        : JSON.stringify(row.output).length
    );

    expect(toolCalls().map((e) => e.outputChars)).toEqual(stored);
    expect(stored).toEqual([4, 40]);
  });

  test("the event text store gets the tool and its input, never the output", () => {
    logToolCall(readCall("the file's words"));

    expect(eventText()).toEqual([
      {
        id: toolCalls()[0]?.id,
        ts: toolCalls()[0]?.ts,
        type: "tool_call",
        tool: "Read",
        input: { file_path: "/work/notes.md" },
      },
    ]);
  });

  test("a broken tool output store never fails the hook and keeps the event", () => {
    mkdirSync(resolve(home, "memory", "content"), { recursive: true });
    writeFileSync(resolve(home, "memory", "content", "tool-output"), "not a folder");

    expect(() => logToolCall(readCall("four"))).not.toThrow();
    expect(toolCalls()).toHaveLength(1);
  });

  test("a read of a sensitive path keeps its row and size but withholds the output", () => {
    logToolCall(readCall("API_KEY=hunter2\n", "/work/app/.env"));
    logToolCall(readCall("-----BEGIN KEY-----", "/home/u/keys/id_rsa"));
    const events = toolCalls();

    expect(outputs()).toEqual(
      events.map((event) => ({
        id: event.id,
        ts: event.ts,
        tool: "Read",
        output: null,
        withheld: true,
      }))
    );
    expect(events.map((event) => event.outputChars)).toEqual([16, 19]);
  });

  test("a template dotenv and an ordinary file keep their output with no withheld key", () => {
    logToolCall(readCall("API_KEY=\n", "/work/app/.env.example"));
    logToolCall(readCall("plain words", "/work/app/src/index.ts"));
    const events = toolCalls();

    expect(outputs()).toEqual([
      { id: events[0]?.id, ts: events[0]?.ts, tool: "Read", output: "API_KEY=\n" },
      { id: events[1]?.id, ts: events[1]?.ts, tool: "Read", output: "plain words" },
    ]);
  });

  test("the tool output store is left out of an export", () => {
    logToolCall(readCall("four"));

    expect(outputs()).toHaveLength(1);
    expect(collectExportFiles().filter((f) => f.includes("tool-output"))).toEqual([]);
  });
});

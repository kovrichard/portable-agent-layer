import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readTranscriptFile, withFinalReply } from "../src/hooks/lib/transcript";
import { removeOnceReleased } from "./lib/remove-once-released";

describe("withFinalReply", () => {
  const asked = [{ role: "user", content: "ask" }];

  test("adds a final reply the file does not have yet", () => {
    expect(withFinalReply(asked, "answer")).toEqual([
      ...asked,
      { role: "assistant", content: "answer" },
    ]);
  });

  test("does not repeat a reply the file already ends with", () => {
    const answered = [...asked, { role: "assistant", content: "answer" }];
    expect(withFinalReply(answered, "answer")).toEqual(answered);
  });

  test("leaves the transcript alone when the agent passed no reply", () => {
    expect(withFinalReply(asked, undefined)).toEqual(asked);
    expect(withFinalReply(asked, "  ")).toEqual(asked);
  });
});

function withTmpFile(content: string, fn: (path: string) => void): void {
  const dir = mkdtempSync(resolve(tmpdir(), "pal-transcript-test-"));
  const path = resolve(dir, "transcript.jsonl");
  try {
    writeFileSync(path, content, "utf-8");
    fn(path);
  } finally {
    removeOnceReleased(dir);
  }
}

describe("readTranscriptFile — Claude Code shape", () => {
  test("extracts string content", () => {
    withTmpFile(
      [
        JSON.stringify({ type: "user", message: { content: "hi" } }),
        JSON.stringify({ type: "assistant", message: { content: "hello" } }),
      ].join("\n"),
      (path) => {
        expect(readTranscriptFile(path)).toEqual([
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ]);
      }
    );
  });

  test("extracts text blocks from array content", () => {
    withTmpFile(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "a" },
            { type: "tool_use" },
            { type: "text", text: "b" },
          ],
        },
      }),
      (path) => {
        expect(readTranscriptFile(path)).toEqual([{ role: "assistant", content: "a b" }]);
      }
    );
  });

  test("skips entries with no extractable text", () => {
    withTmpFile(
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use" }] } }),
      (path) => {
        expect(readTranscriptFile(path)).toEqual([]);
      }
    );
  });
});

describe("readTranscriptFile — VS Code Copilot shape", () => {
  test("extracts user.message and assistant.message content", () => {
    withTmpFile(
      [
        JSON.stringify({ type: "session.start", data: { sessionId: "abc" } }),
        JSON.stringify({
          type: "user.message",
          data: { content: "hey man, did it work?", attachments: [] },
        }),
        JSON.stringify({ type: "assistant.turn_start", data: { turnId: "0" } }),
        JSON.stringify({
          type: "assistant.message",
          data: { content: "checking now", toolRequests: [] },
        }),
        JSON.stringify({ type: "assistant.turn_end", data: { turnId: "0" } }),
        JSON.stringify({
          type: "tool.execution_start",
          data: { toolCallId: "1", toolName: "run_in_terminal" },
        }),
        JSON.stringify({
          type: "tool.execution_complete",
          data: { toolCallId: "1", success: true },
        }),
      ].join("\n"),
      (path) => {
        expect(readTranscriptFile(path)).toEqual([
          { role: "user", content: "hey man, did it work?" },
          { role: "assistant", content: "checking now" },
        ]);
      }
    );
  });

  test("skips assistant.message with empty content (tool-call-only turn)", () => {
    withTmpFile(
      JSON.stringify({
        type: "assistant.message",
        data: { content: "", toolRequests: [{ name: "x" }] },
      }),
      (path) => {
        expect(readTranscriptFile(path)).toEqual([]);
      }
    );
  });

  test("parses the real VS Code transcript fixture end to end", () => {
    withTmpFile(
      [
        JSON.stringify({ type: "session.start", data: {} }),
        JSON.stringify({
          type: "user.message",
          data: { content: "hey man, did it work?" },
        }),
        JSON.stringify({ type: "assistant.turn_start", data: { turnId: "0" } }),
        JSON.stringify({
          type: "assistant.message",
          data: {
            content: "I'm checking the latest verification.",
            toolRequests: [{ name: "run_in_terminal" }],
          },
        }),
        JSON.stringify({ type: "assistant.turn_end", data: { turnId: "0" } }),
      ].join("\n"),
      (path) => {
        const messages = readTranscriptFile(path);
        expect(messages.length).toBe(2);
        expect(messages[0]).toEqual({ role: "user", content: "hey man, did it work?" });
        expect(messages[1].role).toBe("assistant");
      }
    );
  });
});

function codexMessage(role: string, ...texts: string[]): string {
  const partType = role === "assistant" ? "output_text" : "input_text";
  return JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: texts.map((text) => ({ type: partType, text })),
    },
  });
}

describe("readTranscriptFile — Codex shape", () => {
  test("extracts the user and assistant messages of a turn", () => {
    withTmpFile(
      [
        JSON.stringify({ type: "session_meta", payload: { id: "abc" } }),
        codexMessage("developer", "sandbox rules"),
        codexMessage("user", "what changed?"),
        JSON.stringify({ type: "response_item", payload: { type: "reasoning" } }),
        JSON.stringify({
          type: "response_item",
          payload: { type: "custom_tool_call", name: "shell" },
        }),
        codexMessage("assistant", "two files"),
        JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } }),
      ].join("\n"),
      (path) => {
        expect(readTranscriptFile(path)).toEqual([
          { role: "user", content: "what changed?" },
          { role: "assistant", content: "two files" },
        ]);
      }
    );
  });

  test("joins a message split across several text parts", () => {
    withTmpFile(codexMessage("assistant", "first", "second"), (path) => {
      expect(readTranscriptFile(path)).toEqual([
        { role: "assistant", content: "first second" },
      ]);
    });
  });

  test("skips a message with no text in it", () => {
    withTmpFile(codexMessage("assistant", ""), (path) => {
      expect(readTranscriptFile(path)).toEqual([]);
    });
  });

  test("skips the instructions and environment Codex injects as a user message", () => {
    withTmpFile(
      [
        codexMessage(
          "user",
          "# AGENTS.md instructions\n\n<INSTRUCTIONS>\nbe brief\n</INSTRUCTIONS>",
          "<environment_context>\n  <cwd>/work</cwd>\n</environment_context>"
        ),
        codexMessage("user", "what changed?"),
      ].join("\n"),
      (path) => {
        expect(readTranscriptFile(path)).toEqual([
          { role: "user", content: "what changed?" },
        ]);
      }
    );
  });
});

describe("readTranscriptFile — malformed input", () => {
  test("returns [] for a missing file", () => {
    expect(readTranscriptFile(resolve(tmpdir(), "pal-does-not-exist.jsonl"))).toEqual([]);
  });

  test("skips malformed lines without throwing", () => {
    withTmpFile(
      ["not json", JSON.stringify({ type: "user", message: { content: "ok" } })].join(
        "\n"
      ),
      (path) => {
        expect(readTranscriptFile(path)).toEqual([{ role: "user", content: "ok" }]);
      }
    );
  });
});

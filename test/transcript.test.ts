import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  messagesAfter,
  readTranscriptFile,
  recentMessages,
  withFinalReply,
} from "../src/hooks/lib/transcript";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

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
  const dir = freshTestDir(import.meta.file);
  const path = resolve(dir, "transcript.jsonl");
  try {
    writeFileSync(path, content, "utf-8");
    fn(path);
  } finally {
    removeOnceReleased(dir);
  }
}

function claudeLine(role: "user" | "assistant", text: string, uuid: string): string {
  return JSON.stringify({ type: role, uuid, message: { role, content: text } });
}

function turns(count: number, padding = ""): string {
  return Array.from({ length: count }, (_, i) =>
    [
      claudeLine("user", `ask ${i}`, `u${i}`),
      claudeLine("assistant", `answer ${i}${padding}`, `a${i}`),
    ].join("\n")
  ).join("\n");
}

describe("message ids", () => {
  test("each agent's line id becomes the message id", () => {
    const lines = [
      claudeLine("user", "claude", "uuid-1"),
      JSON.stringify({ type: "user.message", id: "cp-1", data: { content: "copilot" } }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          id: "cx-1",
          content: [{ text: "codex" }],
        },
      }),
    ].join("\n");
    withTmpFile(lines, (path) => {
      expect(readTranscriptFile(path).map((m) => m.id)).toEqual([
        "uuid-1",
        "cp-1",
        "cx-1",
      ]);
    });
  });
});

describe("recentMessages", () => {
  test("reads only the end of a transcript far larger than its budget", () => {
    withTmpFile(turns(2000, " pad".repeat(50)), (path) => {
      const recent = recentMessages(path, 3, 64 * 1024);
      expect(recent.length).toBeLessThan(400);
      expect(recent.at(-1)?.id).toBe("a1999");
    });
  });

  test("grows the read until it holds enough user messages", () => {
    const longReply = claudeLine("assistant", "x".repeat(600 * 1024), "big");
    withTmpFile([turns(12), longReply].join("\n"), (path) => {
      const users = recentMessages(path, 10).filter((m) => m.role === "user");
      expect(users.length).toBeGreaterThanOrEqual(10);
    });
  });

  test("returns the whole transcript when it is smaller than the budget", () => {
    withTmpFile(turns(3), (path) => {
      expect(recentMessages(path, 10)).toEqual(readTranscriptFile(path));
    });
  });

  test("a missing file reads as no messages", () => {
    expect(recentMessages("/nonexistent/transcript.jsonl", 10)).toEqual([]);
  });
});

describe("messagesAfter", () => {
  const messages = [
    { role: "user", content: "a", id: "1" },
    { role: "assistant", content: "b", id: "2" },
    { role: "user", content: "c", id: "3" },
  ];

  test("returns what follows the id", () => {
    expect(messagesAfter(messages, "2").map((m) => m.id)).toEqual(["3"]);
  });

  test("returns everything for an unknown or missing id", () => {
    expect(messagesAfter(messages, "9")).toHaveLength(3);
    expect(messagesAfter(messages, undefined)).toHaveLength(3);
  });
});

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
    expect(
      readTranscriptFile(
        resolve(freshTestDir(import.meta.file), "pal-does-not-exist.jsonl")
      )
    ).toEqual([]);
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

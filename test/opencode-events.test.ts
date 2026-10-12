import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  logOpencodeCompaction,
  logOpencodePermissionReply,
  logOpencodeSessionCreated,
  logOpencodeToolFailure,
  rememberAskedTool,
} from "../src/hooks/lib/opencode-events";
import { agentDirOverrides } from "../src/hooks/lib/paths";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

// Shapes from @opencode-ai/sdk's generated Event types (v1, which the plugin
// receives, and v2's renamed permission reply), not from captured runs.

let home: string;

function streamed(type: string): Record<string, unknown>[] {
  const dir = resolve(home, "memory", "events");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(resolve(dir, f), "utf-8").trim().split("\n"))
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === type);
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "opencode";
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("an opencode session starting", () => {
  test("a new top-level session is a session start", () => {
    logOpencodeSessionCreated({ id: "ses_1" });
    expect(streamed("session_start")).toEqual([
      expect.objectContaining({ session: "ses_1", source: "startup" }),
    ]);
  });

  test("a subagent's child session is not one", () => {
    logOpencodeSessionCreated({ id: "ses_child", parentID: "ses_1" });
    expect(streamed("session_start")).toEqual([]);
  });
});

describe("an opencode compaction", () => {
  test("is logged against its session, with no trigger opencode does not send", () => {
    logOpencodeCompaction("ses_1");
    expect(streamed("compaction")).toEqual([
      expect.objectContaining({ session: "ses_1", trigger: null }),
    ]);
  });
});

describe("an opencode permission reply", () => {
  test("a rejection is a denied call of the tool that asked", () => {
    rememberAskedTool({ id: "per_1", type: "edit" });
    logOpencodePermissionReply({
      sessionID: "ses_1",
      permissionID: "per_1",
      response: "reject",
    });
    expect(streamed("tool_call")).toEqual([
      expect.objectContaining({ session: "ses_1", tool: "edit", outcome: "denied" }),
    ]);
  });

  test("v2's requestID and reply name the same thing", () => {
    rememberAskedTool({ id: "per_2", type: "bash" });
    logOpencodePermissionReply({
      sessionID: "ses_1",
      requestID: "per_2",
      reply: "reject",
    });
    expect(streamed("tool_call").map((e) => e.tool)).toEqual(["bash"]);
  });

  test("an approval is no call yet, since the tool still runs and logs itself", () => {
    rememberAskedTool({ id: "per_3", type: "edit" });
    logOpencodePermissionReply({
      sessionID: "ses_1",
      permissionID: "per_3",
      response: "once",
    });
    expect(streamed("tool_call")).toEqual([]);
  });

  test("a rejection whose ask PAL never saw is not guessed at", () => {
    logOpencodePermissionReply({
      sessionID: "ses_1",
      permissionID: "unseen",
      response: "reject",
    });
    expect(streamed("tool_call")).toEqual([]);
  });

  test("an answered ask is forgotten, so a repeated reply logs nothing", () => {
    rememberAskedTool({ id: "per_4", type: "edit" });
    const reply = { sessionID: "ses_1", permissionID: "per_4", response: "reject" };
    logOpencodePermissionReply(reply);
    logOpencodePermissionReply(reply);
    expect(streamed("tool_call")).toHaveLength(1);
  });
});

describe("an opencode tool part that ends in error", () => {
  function erroredPart(callID: string, error: string) {
    return {
      type: "tool",
      callID,
      sessionID: "ses_1",
      tool: "bash",
      state: {
        status: "error",
        input: { command: "ls /missing" },
        error,
        time: { start: 1_000, end: 1_250 },
      },
    };
  }

  test("is a failed call, with its tool, input and duration", () => {
    logOpencodeToolFailure(erroredPart("call_1", "ls: cannot access '/missing'"));
    expect(streamed("tool_call")).toEqual([
      expect.objectContaining({
        session: "ses_1",
        tool: "bash",
        outcome: "failed",
        program: "ls",
        durationMs: 250,
      }),
    ]);
  });

  test("a part updated again after it failed is logged once", () => {
    const part = erroredPart("call_2", "boom");
    logOpencodeToolFailure(part);
    logOpencodeToolFailure(part);
    expect(streamed("tool_call")).toHaveLength(1);
  });

  test("a call a permission rule blocked is denied, not failed", () => {
    logOpencodeToolFailure(
      erroredPart(
        "call_3",
        "The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules []"
      )
    );
    expect(streamed("tool_call").map((e) => e.outcome)).toEqual(["denied"]);
  });

  test("a call the user rejected is left to the permission reply that already logs it", () => {
    logOpencodeToolFailure(
      erroredPart(
        "call_4",
        "The user rejected permission to use this specific tool call."
      )
    );
    expect(streamed("tool_call")).toEqual([]);
  });

  test("a part still running, or one that is not a tool, is no call", () => {
    const running = erroredPart("call_5", "");
    logOpencodeToolFailure({
      ...running,
      state: { ...running.state, status: "running" },
    });
    logOpencodeToolFailure({ type: "text", callID: "call_6" });
    expect(streamed("tool_call")).toEqual([]);
  });
});

describe("the opencode plugin routes its bus events to these loggers", () => {
  // biome-ignore lint/suspicious/noExplicitAny: the plugin's opencode-typed hooks
  async function plugin(): Promise<any> {
    for (const { env } of agentDirOverrides()) process.env[env] = resolve(home, env);
    const { default: PALPlugin } = await import("../src/targets/opencode/plugin");
    return await PALPlugin({ directory: home, client: {} } as never);
  }

  test("a created session, a compaction, a rejected ask and a failed tool each land", async () => {
    const hooks = await plugin();
    await hooks.event({
      event: { type: "session.created", properties: { info: { id: "ses_p" } } },
    });
    await hooks.event({
      event: { type: "session.compacted", properties: { sessionID: "ses_p" } },
    });
    await hooks["permission.ask"]({ id: "per_p", type: "edit", sessionID: "ses_p" }, {});
    await hooks.event({
      event: {
        type: "permission.replied",
        properties: { sessionID: "ses_p", permissionID: "per_p", response: "reject" },
      },
    });
    await hooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            callID: "call_p",
            sessionID: "ses_p",
            tool: "read",
            state: {
              status: "error",
              input: {},
              error: "ENOENT",
              time: { start: 1, end: 2 },
            },
          },
        },
      },
    });

    expect(streamed("session_start").map((e) => e.session)).toEqual(["ses_p"]);
    expect(streamed("compaction").map((e) => e.session)).toEqual(["ses_p"]);
    expect(streamed("tool_call").map((e) => [e.tool, e.outcome])).toEqual([
      ["edit", "denied"],
      ["read", "failed"],
    ]);
  });
});

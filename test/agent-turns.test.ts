import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileFinalReply, hookSessionId } from "../src/hooks/lib/hook-turn";
import { observeTurn, recordReply } from "../src/hooks/lib/interaction";
import {
  parkPromptContext,
  transformedPromptResponse,
} from "../src/hooks/lib/parked-context";
import { finishDeferredStop, stopTurn } from "../src/hooks/lib/stop";
import {
  asAgent,
  EARLIER_EXCHANGE,
  EVENT_LOG,
  loggedTurns,
  opencode,
  opencodePlugin,
  paths,
  REPO,
  replyFiledFor,
  startEachTestInACleanHome,
  trackedReply,
  transcriptFile,
  transformed,
} from "./lib/agent-turns-fixture";

startEachTestInACleanHome(import.meta.file);

/** Short, quick turns that change the session's picture and so earn a hint. */
function hintEarningTurns(session: string): void {
  observeTurn("start the work", session);
  for (let i = 0; i < 4; i++) {
    recordReply(session, "short answer");
    observeTurn("yes pls", session);
  }
}

describe("cursor is not known to hear per-turn context", () => {
  test("never logs a hint as sent", async () => {
    await asAgent("cursor", () => hintEarningTurns("cu1"));

    expect(loggedTurns().some((turn) => turn.hinted)).toBe(false);
  });

  test("the same turns do earn a hint where the agent can hear it", async () => {
    await asAgent("claude", () => hintEarningTurns("cu1"));

    expect(loggedTurns().some((turn) => turn.hinted)).toBe(true);
  });
});

describe("copilot, whose prompt hook output is dropped", () => {
  test("drops context parked too long ago to belong to this prompt", async () => {
    parkPromptContext("cp1", "stale", new Date(Date.now() - 10 * 60_000));

    expect(transformedPromptResponse(transformed())).toBeNull();
  });

  test("logs a hint as sent, since it now reaches the model", async () => {
    await asAgent("copilot", () => hintEarningTurns("cp1"));

    expect(loggedTurns().some((turn) => turn.hinted)).toBe(true);
  });

  test("the install wires userPromptTransformed to that hook", () => {
    const hooks = JSON.parse(
      readFileSync(resolve(REPO, "assets", "templates", "hooks.copilot.json"), "utf-8")
    ).hooks;

    expect(JSON.stringify(hooks.userPromptTransformed)).toContain(
      "src/hooks/PromptTransformed.ts --agent=copilot"
    );
  });
});

describe("cursor", () => {
  test("files the reply afterAgentResponse hands over, under the prompt's conversation", () => {
    const prompt = {
      conversation_id: "cu1",
      generation_id: "g1",
      hook_event_name: "beforeSubmitPrompt",
      prompt: "rename the column",
    };
    observeTurn(prompt.prompt, hookSessionId(prompt));
    const response = {
      conversation_id: "cu1",
      generation_id: "g1",
      hook_event_name: "afterAgentResponse",
      text: "Renamed it in both tables.",
    };
    fileFinalReply(response);

    expect(replyFiledFor("cu1")).toMatchObject({ words: 5 });
  });
});

describe("codex", () => {
  const prompt = { session_id: "thr_1", turn_id: "t1", prompt: "rename the column" };

  test("files the reply it hands over even when its transcript is unreadable", async () => {
    observeTurn(prompt.prompt, hookSessionId(prompt));
    const stop = {
      session_id: "thr_1",
      turn_id: "t1",
      stop_hook_active: false,
      transcript_path: transcriptFile("rollout.jsonl", [
        { type: "response_item", payload: { type: "message", role: "assistant" } },
      ]),
      last_assistant_message: "Renamed it in both tables.",
    };
    await stopTurn(stop);

    expect(replyFiledFor("thr_1")).toMatchObject({ words: 5 });
  });

  test("files the reply it hands over at once, even before its transcript has it", async () => {
    observeTurn(prompt.prompt, hookSessionId(prompt));
    await stopTurn({
      session_id: "thr_1",
      transcript_path: transcriptFile("rollout.jsonl", [
        { type: "user", message: { content: prompt.prompt } },
      ]),
      last_assistant_message: "Renamed it in both tables.",
    });

    expect(replyFiledFor("thr_1")).toMatchObject({ words: 5 });
  });

  test("files the reply when no transcript is offered at all", async () => {
    observeTurn(prompt.prompt, hookSessionId(prompt));
    await stopTurn({ session_id: "thr_1", last_assistant_message: "Done." });

    expect(replyFiledFor("thr_1")).toMatchObject({ words: 1 });
  });
});

describe("copilot", () => {
  const earlier = EARLIER_EXCHANGE;

  test("files nothing when the reply never lands", async () => {
    observeTurn("rename the column", "cp1");
    const payloadPath = resolve(paths.home, "stop.json");
    writeFileSync(
      payloadPath,
      JSON.stringify({
        sessionId: "cp1",
        transcriptPath: transcriptFile("copilot.jsonl", [
          ...earlier,
          ...EVENT_LOG.slice(0, 1),
        ]),
      })
    );
    await finishDeferredStop(payloadPath, { timeoutMs: 50, intervalMs: 10 });

    expect(trackedReply("cp1")).toBeUndefined();
    expect(existsSync(payloadPath)).toBe(false);
  });
});

describe("opencode", () => {
  const plugin = opencodePlugin;

  test("a file diff mid-turn does not end the turn", async () => {
    const hooks = await plugin();
    await asAgent("opencode", () =>
      hooks.event({ event: { type: "session.diff", properties: { sessionID: "oc1" } } })
    );

    expect(opencode.transcriptFetches).toBe(0);
  });

  function debugLog(): string {
    const path = resolve(paths.home, "debug", "debug.log");
    return existsSync(path) ? readFileSync(path, "utf-8") : "";
  }

  test("debug logging records session events but not the streamed reply", async () => {
    mkdirSync(resolve(paths.home, "memory", "state"), { recursive: true });
    writeFileSync(resolve(paths.home, "memory", "state", "debug-enabled"), "");
    const hooks = await plugin();
    const events = ["message.part.delta", "message.part.updated", "session.status"];
    for (const type of events) {
      await asAgent("opencode", () => hooks.event({ event: { type, properties: {} } }));
    }

    expect(debugLog()).toContain("Event: session.status");
    expect(debugLog()).not.toContain("Event: message.");
  });
});

const WIRING = [
  ["claude", "settings.claude.json", "UserPromptSubmit", ["Stop"]],
  ["codex", "hooks.codex.json", "UserPromptSubmit", ["Stop"]],
  ["copilot", "hooks.copilot.json", "userPromptSubmitted", ["agentStop"]],
  ["vscode", "hooks.vscode.json", "UserPromptSubmit", ["Stop"]],
  ["cursor", "hooks.cursor.json", "beforeSubmitPrompt", ["stop", "afterAgentResponse"]],
] as const;

const REPLY_HOOK: Record<string, string> = {
  afterAgentResponse: "AgentResponse.ts",
};

describe.each(WIRING)("%s install", (agent, file, promptEvent, replyEvents) => {
  const hooks = JSON.parse(
    readFileSync(resolve(REPO, "assets", "templates", file), "utf-8")
  ).hooks;

  test(`measures each prompt on ${promptEvent}`, () => {
    expect(JSON.stringify(hooks[promptEvent])).toContain(
      `src/hooks/UserPromptOrchestrator.ts --agent=${agent}`
    );
  });

  test.each([...replyEvents])("files the reply on %s", (event) => {
    const entry = REPLY_HOOK[event] ?? "StopOrchestrator.ts";
    expect(JSON.stringify(hooks[event])).toContain(`src/hooks/${entry} --agent=${agent}`);
  });
});

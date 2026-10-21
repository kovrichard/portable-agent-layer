import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { observeTurn } from "../src/hooks/lib/interaction";
import { transformedPromptResponse } from "../src/hooks/lib/parked-context";
import { finishDeferredStop, stopTurn } from "../src/hooks/lib/stop";
import {
  asAgent,
  copilotPrompt,
  EARLIER_EXCHANGE,
  EVENT_LOG,
  loggedTurns,
  opencode,
  opencodePlugin,
  type PromptPayload,
  paths,
  promptHookOutput,
  REPO,
  replyFiledFor,
  startEachTestInACleanHome,
  trackedReply,
  transcriptFile,
  transformed,
} from "./lib/agent-turns-fixture";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

// stopTurn can spawn detached children that keep writing into PAL_HOME after the
// test returns; .gitignore covers .test/ for that reason.
const AGENT_RESPONSE_HOOK = resolve(REPO, "src", "hooks", "AgentResponse.ts");

startEachTestInACleanHome(import.meta.file);

/** A reply filed by a detached child shows up in the session's track a moment later. */
async function filedReply(session: string, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reply = trackedReply(session);
    if (reply) return reply;
    await Bun.sleep(50);
  }
  return undefined;
}

describe("cursor's prompt hook, which documents no context field", () => {
  test("logs the turn and still offers the context as additional_context", async () => {
    const out = await promptHookOutput("cursor", {
      conversation_id: "cu1",
      hook_event_name: "beforeSubmitPrompt",
      prompt: "rename the column",
    } as PromptPayload);

    expect(JSON.parse(out).additional_context).toContain("Now: ");
    expect(loggedTurns().at(-1)?.session).toBe("cu1");
  });
});

describe("copilot, whose prompt hook output is dropped", () => {
  const prompt = copilotPrompt;

  function modelFacing(out: string | null): string {
    return JSON.parse(out ?? "{}").modifiedTransformedPrompt;
  }

  test("logs the turn and writes nothing on userPromptSubmitted", async () => {
    const out = await promptHookOutput("copilot", prompt);

    expect(out).toBe("");
    expect(loggedTurns().at(-1)?.session).toBe("cp1");
  });

  test("appends the context to the model-facing prompt on userPromptTransformed", async () => {
    await promptHookOutput("copilot", prompt);
    const facing = modelFacing(transformedPromptResponse(transformed()));

    expect(facing.startsWith("<context>repo</context>\nrename the column\n\n")).toBe(
      true
    );
    expect(facing).toContain("Now: ");
  });

  test("hands the context over once", async () => {
    await promptHookOutput("copilot", prompt);
    transformedPromptResponse(transformed());

    expect(transformedPromptResponse(transformed())).toBeNull();
  });

  test("never hands one session's context to another", async () => {
    await promptHookOutput("copilot", prompt);

    expect(transformedPromptResponse(transformed({ sessionId: "cp2" }))).toBeNull();
  });

  test("leaves the prompt alone without a model-facing prompt to extend", async () => {
    await promptHookOutput("copilot", prompt);

    expect(transformedPromptResponse(transformed({ transformedPrompt: "" }))).toBeNull();
  });

  test("the installed hook prints the extended prompt", async () => {
    await promptHookOutput("copilot", prompt);
    const result = spawnSync(
      "bun",
      ["run", resolve(REPO, "src", "hooks", "PromptTransformed.ts"), "--agent=copilot"],
      {
        env: { ...process.env, PAL_HOME: paths.home },
        input: JSON.stringify(transformed()),
        encoding: "utf-8",
        timeout: 10000,
      }
    );

    expect(result.status).toBe(0);
    expect(modelFacing(result.stdout)).toContain("Now: ");
  });
});

function hookSpecificContext(out: string): string {
  const parsed = JSON.parse(out);
  expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  return parsed.hookSpecificOutput.additionalContext;
}

describe("vscode", () => {
  test("logs the turn and hands the context back as hookSpecificOutput", async () => {
    const prompt = {
      session_id: "vs1",
      hook_event_name: "UserPromptSubmit",
      prompt: "rename the column",
    };
    const out = await promptHookOutput("vscode", prompt);

    expect(hookSpecificContext(out)).toContain("Now: ");
    expect(loggedTurns().at(-1)?.session).toBe("vs1");
  });
});

describe("cursor", () => {
  test("the installed hook files the reply it is handed", () => {
    observeTurn("rename the column", "cu2");
    const result = spawnSync("bun", ["run", AGENT_RESPONSE_HOOK, "--agent=cursor"], {
      env: { ...process.env, PAL_HOME: paths.home },
      input: JSON.stringify({ conversation_id: "cu2", text: "Renamed it." }),
      encoding: "utf-8",
      timeout: 10000,
    });

    expect(result.status).toBe(0);
    expect(replyFiledFor("cu2")).toMatchObject({ words: 2 });
  });
});

describe("codex", () => {
  const prompt = { session_id: "thr_1", turn_id: "t1", prompt: "rename the column" };

  test("logs the turn and hands the context back as hookSpecificOutput", async () => {
    const out = await promptHookOutput("codex", prompt);

    expect(hookSpecificContext(out)).toContain("Now: ");
    expect(loggedTurns().at(-1)?.session).toBe("thr_1");
  });
});

describe("claude", () => {
  test("logs the turn and hands the context back as plain text", async () => {
    const out = await promptHookOutput("claude", {
      session_id: "c1",
      prompt: "rename the column",
    });

    expect(out).toContain("Now: ");
    expect(out.trimStart().startsWith("{")).toBe(false);
    expect(loggedTurns().at(-1)?.session).toBe("c1");
  });

  test("files the reply from its transcript", async () => {
    observeTurn("rename the column", "c1");
    await stopTurn({
      session_id: "c1",
      transcript_path: transcriptFile("claude.jsonl", [
        { type: "user", message: { content: "rename the column" } },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Renamed it in both tables." }] },
        },
      ]),
    });

    expect(replyFiledFor("c1")).toMatchObject({ words: 5 });
  });
});

describe("copilot", () => {
  const earlier = EARLIER_EXCHANGE;

  test("files the reply from the transcript agentStop points at", async () => {
    observeTurn("rename the column", "cp1");
    const stop = {
      sessionId: "cp1",
      stopReason: "end_turn",
      transcriptPath: transcriptFile("copilot.jsonl", EVENT_LOG),
    };
    await stopTurn(stop);

    expect(replyFiledFor("cp1")).toMatchObject({ words: 5 });
  });

  test("files the reply it writes to the transcript only after agentStop returns", async () => {
    observeTurn("rename the column", "cp1");
    const transcriptPath = transcriptFile("copilot.jsonl", EVENT_LOG.slice(0, 1));
    await stopTurn({ sessionId: "cp1", transcriptPath });
    transcriptFile("copilot.jsonl", EVENT_LOG);

    expect(await filedReply("cp1")).toMatchObject({ words: 5 });
  });

  test("never files the previous turn's reply for a resumed turn", async () => {
    observeTurn("rename the column", "cp1");
    const transcriptPath = transcriptFile("copilot.jsonl", [
      ...earlier,
      ...EVENT_LOG.slice(0, 1),
    ]);
    await stopTurn({ sessionId: "cp1", transcriptPath });
    transcriptFile("copilot.jsonl", [...earlier, ...EVENT_LOG]);

    expect(await filedReply("cp1")).toMatchObject({ words: 5 });
  });

  test("a deferred stop waits for the reply and files it, not the one before", async () => {
    observeTurn("rename the column", "cp1");
    const transcriptPath = transcriptFile("copilot.jsonl", [
      ...earlier,
      ...EVENT_LOG.slice(0, 1),
    ]);
    const payloadPath = resolve(paths.home, "stop.json");
    writeFileSync(payloadPath, JSON.stringify({ sessionId: "cp1", transcriptPath }));
    const finished = finishDeferredStop(payloadPath, { timeoutMs: 2000, intervalMs: 10 });
    await Bun.sleep(50);
    transcriptFile("copilot.jsonl", [...earlier, ...EVENT_LOG]);
    await finished;

    expect(trackedReply("cp1")).toMatchObject({ words: 5 });
    expect(existsSync(payloadPath)).toBe(false);
  });
});

describe("vscode", () => {
  test("files the reply from the transcript Stop points at", async () => {
    observeTurn("rename the column", "vs1");
    const stop = {
      session_id: "vs1",
      stop_hook_active: false,
      transcript_path: transcriptFile("vscode.jsonl", EVENT_LOG),
    };
    await stopTurn(stop);

    expect(replyFiledFor("vs1")).toMatchObject({ words: 5 });
  });
});

describe("opencode", () => {
  const plugin = opencodePlugin;

  test("logs the turn and adds the context as a synthetic part", async () => {
    const hooks = await plugin();
    const output = { parts: [{ type: "text", text: "rename the column" }] };
    await asAgent("opencode", () =>
      hooks["chat.message"]({ sessionID: "oc1", messageID: "m1" }, output)
    );

    expect(output.parts[0]).toMatchObject({ synthetic: true, sessionID: "oc1" });
    expect(String((output.parts[0] as { text: string }).text)).toContain("Now: ");
    expect(loggedTurns().at(-1)?.session).toBe("oc1");
  });

  test("files the reply when the session goes idle", async () => {
    const hooks = await plugin();
    observeTurn("rename the column", "oc1");
    await asAgent("opencode", () =>
      hooks.event({ event: { type: "session.idle", properties: { sessionID: "oc1" } } })
    );

    expect(replyFiledFor("oc1")).toMatchObject({ words: 5 });
  });

  test("an idle session ends the turn once", async () => {
    const hooks = await plugin();
    await asAgent("opencode", () =>
      hooks.event({ event: { type: "session.idle", properties: { sessionID: "oc1" } } })
    );

    expect(opencode.transcriptFetches).toBe(1);
  });
});

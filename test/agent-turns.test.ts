import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { injectPromptContext } from "../src/hooks/handlers/inject-retrieval";
import {
  fileFinalReply,
  type HookTurnPayload,
  hookSessionId,
} from "../src/hooks/lib/hook-turn";
import { observeTurn, recordReply, type TurnEvent } from "../src/hooks/lib/interaction";
import {
  parkPromptContext,
  type TransformedPromptPayload,
  transformedPromptResponse,
} from "../src/hooks/lib/parked-context";
import { reload } from "../src/hooks/lib/settings";
import { finishDeferredStop, stopTurn } from "../src/hooks/lib/stop";
import { sandboxContextRuleDirs } from "./lib/context-rule-dirs";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

// stopTurn can spawn detached children that keep writing into PAL_HOME after the
// test returns; .gitignore covers .test/ for that reason.
const REPO = resolve(import.meta.dir, "..");
const HOME = testHome(import.meta.file);
const AGENT_RESPONSE_HOOK = resolve(REPO, "src", "hooks", "AgentResponse.ts");
const savedHome = process.env.PAL_HOME;
let restoreContextRuleDirs: () => void;

beforeEach(() => {
  removeOnceReleased(HOME);
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  process.env.PAL_HOME = HOME;
  restoreContextRuleDirs = sandboxContextRuleDirs(resolve(HOME, "agents"));
  reload();
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  restoreContextRuleDirs();
  reload();
  removeOnceReleased(HOME);
});

type PromptPayload = HookTurnPayload & { prompt: string };

function loggedTurns(): TurnEvent[] {
  const dir = resolve(HOME, "memory", "signals", "interaction");
  if (!existsSync(dir)) return [];
  const month = new Date().toISOString().slice(0, 7);
  return readFileSync(resolve(dir, `${month}.jsonl`), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function transcriptFile(name: string, lines: unknown[]): string {
  const path = resolve(HOME, name);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  return path;
}

/** The next prompt carries the shape of the reply that answered the last one. */
function replyFiledFor(session: string): TurnEvent["reply"] {
  observeTurn("thanks, next one", session);
  return loggedTurns().at(-1)?.reply ?? null;
}

function trackedReply(session: string): { words: number } | undefined {
  const file = resolve(HOME, "memory", "state", "interaction-sessions.json");
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf-8"))[session]?.reply;
}

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

async function asAgent<T>(agent: string, work: () => T | Promise<T>): Promise<T> {
  const savedAgent = process.env.PAL_AGENT;
  process.env.PAL_AGENT = agent;
  try {
    return await work();
  } finally {
    if (savedAgent === undefined) delete process.env.PAL_AGENT;
    else process.env.PAL_AGENT = savedAgent;
  }
}

async function promptHookOutput(agent: string, payload: PromptPayload) {
  const write = process.stdout.write.bind(process.stdout);
  let out = "";
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (process.stdout as any).write = (chunk: string) => {
    out += chunk;
    return true;
  };
  try {
    await asAgent(agent, () =>
      injectPromptContext(payload.prompt, hookSessionId(payload))
    );
  } finally {
    process.stdout.write = write;
  }
  return out;
}

/** Short, quick turns that change the session's picture and so earn a hint. */
function hintEarningTurns(session: string): void {
  observeTurn("start the work", session);
  for (let i = 0; i < 4; i++) {
    recordReply(session, "short answer");
    observeTurn("yes pls", session);
  }
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
  const prompt = { sessionId: "cp1", prompt: "rename the column" };
  const transformed = (over: Partial<TransformedPromptPayload> = {}) => ({
    sessionId: "cp1",
    timestamp: 1,
    cwd: "/work",
    prompt: "rename the column",
    transformedPrompt: "<context>repo</context>\nrename the column",
    ...over,
  });

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

  test("drops context parked too long ago to belong to this prompt", async () => {
    parkPromptContext("cp1", "stale", new Date(Date.now() - 10 * 60_000));

    expect(transformedPromptResponse(transformed())).toBeNull();
  });

  test("leaves the prompt alone without a model-facing prompt to extend", async () => {
    await promptHookOutput("copilot", prompt);

    expect(transformedPromptResponse(transformed({ transformedPrompt: "" }))).toBeNull();
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

  test("the installed hook prints the extended prompt", async () => {
    await promptHookOutput("copilot", prompt);
    const result = spawnSync(
      "bun",
      ["run", resolve(REPO, "src", "hooks", "PromptTransformed.ts"), "--agent=copilot"],
      {
        env: { ...process.env, PAL_HOME: HOME },
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

  test("the installed hook files the reply it is handed", () => {
    observeTurn("rename the column", "cu2");
    const result = spawnSync("bun", ["run", AGENT_RESPONSE_HOOK, "--agent=cursor"], {
      env: { ...process.env, PAL_HOME: HOME },
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

const EVENT_LOG = [
  { type: "user.message", data: { content: "rename the column" } },
  { type: "assistant.message", data: { content: "Renamed it in both tables." } },
];

describe("copilot", () => {
  const earlier = [
    { type: "user.message", data: { content: "hi" } },
    { type: "assistant.message", data: { content: "Hello." } },
  ];

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
    const payloadPath = resolve(HOME, "stop.json");
    writeFileSync(payloadPath, JSON.stringify({ sessionId: "cp1", transcriptPath }));
    const finished = finishDeferredStop(payloadPath, { timeoutMs: 2000, intervalMs: 10 });
    await Bun.sleep(50);
    transcriptFile("copilot.jsonl", [...earlier, ...EVENT_LOG]);
    await finished;

    expect(trackedReply("cp1")).toMatchObject({ words: 5 });
    expect(existsSync(payloadPath)).toBe(false);
  });

  test("files nothing when the reply never lands", async () => {
    observeTurn("rename the column", "cp1");
    const payloadPath = resolve(HOME, "stop.json");
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
  const conversation = [
    { info: { role: "user" }, parts: [{ type: "text", text: "rename the column" }] },
    {
      info: { role: "assistant" },
      parts: [{ type: "text", text: "Renamed it in both tables." }],
    },
  ];

  let transcriptFetches = 0;

  // biome-ignore lint/suspicious/noExplicitAny: the plugin's opencode-typed hooks
  async function plugin(): Promise<any> {
    const savedAgent = process.env.PAL_AGENT;
    const { default: PALPlugin } = await import("../src/targets/opencode/plugin");
    transcriptFetches = 0;
    const messages = async () => {
      transcriptFetches++;
      return { data: conversation };
    };
    const hooks = await PALPlugin({
      directory: HOME,
      client: { session: { messages } },
    } as never);
    if (savedAgent === undefined) delete process.env.PAL_AGENT;
    else process.env.PAL_AGENT = savedAgent;
    return hooks;
  }

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

  test("a file diff mid-turn does not end the turn", async () => {
    const hooks = await plugin();
    await asAgent("opencode", () =>
      hooks.event({ event: { type: "session.diff", properties: { sessionID: "oc1" } } })
    );

    expect(transcriptFetches).toBe(0);
  });

  test("an idle session ends the turn once", async () => {
    const hooks = await plugin();
    await asAgent("opencode", () =>
      hooks.event({ event: { type: "session.idle", properties: { sessionID: "oc1" } } })
    );

    expect(transcriptFetches).toBe(1);
  });

  function debugLog(): string {
    const path = resolve(HOME, "debug", "debug.log");
    return existsSync(path) ? readFileSync(path, "utf-8") : "";
  }

  test("debug logging records session events but not the streamed reply", async () => {
    mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
    writeFileSync(resolve(HOME, "memory", "state", "debug-enabled"), "");
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

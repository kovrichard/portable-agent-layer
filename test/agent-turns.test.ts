import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { injectPromptContext } from "../src/hooks/handlers/inject-retrieval";
import {
  fileFinalReply,
  type HookTurnPayload,
  hookSessionId,
} from "../src/hooks/lib/hook-turn";
import { observeTurn, recordReply, type TurnEvent } from "../src/hooks/lib/interaction";
import { reload } from "../src/hooks/lib/settings";
import { stopTurn } from "../src/hooks/lib/stop";

// stopTurn can spawn detached children that keep writing into PAL_HOME after the
// test returns; .gitignore covers .test-home-* for that reason.
const REPO = resolve(import.meta.dir, "..");
const HOME = resolve(REPO, ".test-home-agent-turns");
const AGENT_RESPONSE_HOOK = resolve(REPO, "src", "hooks", "AgentResponse.ts");
const savedHome = process.env.PAL_HOME;

beforeEach(() => {
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  process.env.PAL_HOME = HOME;
  reload();
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  reload();
  rmSync(HOME, { recursive: true, force: true });
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

describe.each([
  ["cursor", { conversation_id: "cu1", hook_event_name: "beforeSubmitPrompt" }, "cu1"],
  ["copilot", { sessionId: "cp1", cwd: "/work" }, "cp1"],
])("%s takes no context on a prompt", (agent, ids, session) => {
  test("logs the turn and writes nothing the agent would drop", async () => {
    const out = await promptHookOutput(agent, { ...ids, prompt: "rename the column" });

    expect(out).toBe("");
    expect(loggedTurns().at(-1)?.session).toBe(session);
  });

  test("never logs a hint as sent", async () => {
    await asAgent(agent, () => hintEarningTurns(session));

    expect(loggedTurns().some((turn) => turn.hinted)).toBe(false);
  });

  test("the same turns do earn a hint where the agent can hear it", async () => {
    await asAgent("claude", () => hintEarningTurns(session));

    expect(loggedTurns().some((turn) => turn.hinted)).toBe(true);
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

  test("the install wires afterAgentResponse to that hook", () => {
    const template = readFileSync(
      resolve(REPO, "assets", "templates", "hooks.cursor.json"),
      "utf-8"
    );
    expect(JSON.stringify(JSON.parse(template).hooks.afterAgentResponse)).toContain(
      "src/hooks/AgentResponse.ts --agent=cursor"
    );
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

  test("files the reply when no transcript is offered at all", async () => {
    observeTurn(prompt.prompt, hookSessionId(prompt));
    await stopTurn({ session_id: "thr_1", last_assistant_message: "Done." });

    expect(replyFiledFor("thr_1")).toMatchObject({ words: 1 });
  });
});

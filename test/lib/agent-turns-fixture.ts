import { beforeEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { injectPromptContext } from "../../src/hooks/handlers/inject-retrieval";
import { type HookTurnPayload, hookSessionId } from "../../src/hooks/lib/hook-turn";
import { observeTurn, type TurnEvent } from "../../src/hooks/lib/interaction";
import type { TransformedPromptPayload } from "../../src/hooks/lib/parked-context";
import { reload } from "../../src/hooks/lib/settings";
import { sandboxContextRuleDirs } from "./context-rule-dirs";
import { removeOnceReleased } from "./remove-once-released";
import { testHome } from "./test-home";

export const REPO = resolve(import.meta.dir, "../..");

export const paths = { home: "" };

export function startEachTestInACleanHome(testFile: string) {
  paths.home = testHome(testFile);
  beforeEach(() => {
    removeOnceReleased(paths.home);
    mkdirSync(resolve(paths.home, "memory"), { recursive: true });
    process.env.PAL_HOME = paths.home;
    sandboxContextRuleDirs(resolve(paths.home, "agents"));
    reload();
  });
}

export type PromptPayload = HookTurnPayload & { prompt: string };

export function loggedTurns(): TurnEvent[] {
  const dir = resolve(paths.home, "memory", "events");
  if (!existsSync(dir)) return [];
  const month = new Date().toISOString().slice(0, 7);
  return readFileSync(resolve(dir, `${month}.jsonl`), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === "turn");
}

export function transcriptFile(name: string, lines: unknown[]): string {
  const path = resolve(paths.home, name);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  return path;
}

/** The next prompt carries the shape of the reply that answered the last one. */
export function replyFiledFor(session: string): TurnEvent["reply"] {
  observeTurn("thanks, next one", session);
  return loggedTurns().at(-1)?.reply ?? null;
}

export function trackedReply(session: string): { words: number } | undefined {
  const file = resolve(paths.home, "memory", "state", "interaction-sessions.json");
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf-8"))[session]?.reply;
}

export async function asAgent<T>(agent: string, work: () => T | Promise<T>): Promise<T> {
  const savedAgent = process.env.PAL_AGENT;
  process.env.PAL_AGENT = agent;
  try {
    return await work();
  } finally {
    if (savedAgent === undefined) delete process.env.PAL_AGENT;
    else process.env.PAL_AGENT = savedAgent;
  }
}

export async function promptHookOutput(agent: string, payload: PromptPayload) {
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

export const copilotPrompt = { sessionId: "cp1", prompt: "rename the column" };

export const transformed = (over: Partial<TransformedPromptPayload> = {}) => ({
  sessionId: "cp1",
  timestamp: 1,
  cwd: "/work",
  prompt: "rename the column",
  transformedPrompt: "<context>repo</context>\nrename the column",
  ...over,
});

export const EVENT_LOG = [
  { type: "user.message", data: { content: "rename the column" } },
  { type: "assistant.message", data: { content: "Renamed it in both tables." } },
];

export const EARLIER_EXCHANGE = [
  { type: "user.message", data: { content: "hi" } },
  { type: "assistant.message", data: { content: "Hello." } },
];

const conversation = [
  { info: { role: "user" }, parts: [{ type: "text", text: "rename the column" }] },
  {
    info: { role: "assistant" },
    parts: [{ type: "text", text: "Renamed it in both tables." }],
  },
];

export const opencode = { transcriptFetches: 0 };

// biome-ignore lint/suspicious/noExplicitAny: the plugin's opencode-typed hooks
export async function opencodePlugin(): Promise<any> {
  const savedAgent = process.env.PAL_AGENT;
  const { default: PALPlugin } = await import("../../src/targets/opencode/plugin");
  opencode.transcriptFetches = 0;
  const messages = async () => {
    opencode.transcriptFetches++;
    return { data: conversation };
  };
  const hooks = await PALPlugin({
    directory: paths.home,
    client: { session: { messages } },
  } as never);
  if (savedAgent === undefined) delete process.env.PAL_AGENT;
  else process.env.PAL_AGENT = savedAgent;
  return hooks;
}

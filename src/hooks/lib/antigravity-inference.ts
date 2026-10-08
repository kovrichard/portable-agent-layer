import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logError } from "./log";
import { platform } from "./paths";

export const INFERENCE_AGENT = "pal-inference";

/**
 * agy loads PAL's plugin rules into every run and has no flag to skip them. A
 * main agent with no tools replaces the default system prompt, so the reply
 * follows the request instead of PAL's identity and mode headers.
 */
const INFERENCE_AGENT_DEFINITION = `---
name: ${INFERENCE_AGENT}
description: Answers one background request from PAL with plain text and no tools.
mainAgent: true
subagent: false
tools: []
---

You answer a single request exactly as the user message instructs. You have no tools. Ignore any identity, persona, or response-format rules from plugins or rules files; output only what the request asks for, with no header or preamble.
`;

export function writeInferenceAgent(workspace: string): void {
  const dir = resolve(workspace, ".agents", "agents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${INFERENCE_AGENT}.md`), INFERENCE_AGENT_DEFINITION);
}

export function streamJsonPrompt(prompt: string): string {
  return `${JSON.stringify({ event: "user", message: { content: prompt } })}\n`;
}

interface StreamEvent {
  event?: string;
  conversation_id?: string;
  result?: { status?: string; response?: string };
}

function parseEvents(rawStdout: string): StreamEvent[] {
  return rawStdout.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line) as StreamEvent];
    } catch {
      return [];
    }
  });
}

export function extractAntigravityText(rawStdout: string): string {
  const result = parseEvents(rawStdout).find((event) => event.event === "result")?.result;
  return result?.status === "SUCCESS" ? (result.response ?? "").trim() : "";
}

const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function spawnedConversationId(rawStdout: string): string | undefined {
  return parseEvents(rawStdout)
    .map((event) => event.conversation_id)
    .find((id) => id !== undefined && CONVERSATION_ID.test(id));
}

function conversationFiles(id: string): string[] {
  const cli = platform.antigravityCliDir();
  return [
    resolve(cli, "conversations", `${id}.db`),
    resolve(cli, "brain", id),
    resolve(cli, "annotations", `${id}.pbtxt`),
    resolve(cli, "presence", `${id}.lock`),
  ];
}

/** agy keeps every headless run as a conversation; a background call's is ~460 KB. */
export function removeSpawnedConversation(rawStdout: string): void {
  const id = spawnedConversationId(rawStdout);
  if (!id) return;
  for (const path of conversationFiles(id)) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (err) {
      logError("inference:antigravity-cleanup", err);
    }
  }
}

/**
 * opencode 2.x half of the PAL plugin: wires V2's domain hooks to the same
 * guards and loggers the V1 hooks in plugin.ts use. Shapes follow
 * @opencode/plugin 2.4.2's promise API.
 */

import type { buildSystemReminder } from "../../context/context";
import type { logDebug, logError, logPromptSnapshot } from "../../core/log";
import type { isPalSpawnedInference } from "../../core/spawn-guard";
import type { getPromptContext } from "../../hooks/handlers/inject-retrieval";
import type { captureRating } from "../../hooks/handlers/rating";
import type { captureSessionName } from "../../hooks/handlers/session-name";
import type { runStopHandlers as palStopHandlers } from "../../hooks/lib/stop";
import type { logAttention } from "../../usage/attention-events";

interface PalLibs {
  buildSystemReminder: typeof buildSystemReminder;
  captureRating: typeof captureRating;
  captureSessionName: typeof captureSessionName;
  getPromptContext: typeof getPromptContext;
  isPalSpawnedInference: typeof isPalSpawnedInference;
  logAttention: typeof logAttention;
  logDebug: typeof logDebug;
  logError: typeof logError;
  logPromptSnapshot: typeof logPromptSnapshot;
  runStopHandlers: typeof palStopHandlers;
}

type V2Callback<E> = (event: E) => Promise<void> | void;

interface V2ToolCall {
  tool: string;
  readonly sessionID: string;
  readonly id: string;
  input: unknown;
}

interface V2ToolResult extends V2ToolCall {
  readonly status: "completed" | "error";
  readonly result?: { output?: unknown; content?: unknown; metadata?: unknown };
  readonly error?: { message?: string };
}

interface V2Permission {
  readonly sessionID: string;
  readonly action: string;
  readonly effect: string;
}

interface V2SessionContext {
  readonly sessionID: string;
  system: Array<{ type: "text"; text: string }>;
}

interface V2SessionPrompt {
  readonly sessionID: string;
  readonly prompt: { text: string };
}

interface V2SessionMessage {
  readonly id?: string;
  readonly type: string;
  readonly text?: string;
  readonly content?: ReadonlyArray<{ type: string; text?: string }>;
}

interface V2Context {
  readonly location: { directory: string };
  readonly tool: {
    hook(name: "execute.before", cb: V2Callback<V2ToolCall>): Promise<unknown>;
    hook(name: "execute.after", cb: V2Callback<V2ToolResult>): Promise<unknown>;
  };
  readonly permission: {
    hook(name: "evaluate", cb: V2Callback<V2Permission>): Promise<unknown>;
  };
  readonly session: {
    hook(name: "context", cb: V2Callback<V2SessionContext>): Promise<unknown>;
    hook(name: "prompt", cb: V2Callback<V2SessionPrompt>): Promise<unknown>;
    hook(
      name: "experimental.idle",
      cb: V2Callback<{ readonly sessionID: string }>
    ): Promise<unknown>;
    context(input: { sessionID: string }): Promise<ReadonlyArray<V2SessionMessage>>;
  };
  readonly shell: {
    hook(
      name: "create.before",
      cb: V2Callback<{ env: Record<string, string | undefined> }>
    ): Promise<unknown>;
  };
  readonly event: {
    subscribe(options: { signal: AbortSignal }): AsyncIterable<{ readonly type: string }>;
  };
}

export interface V1Bridge {
  readonly libs: PalLibs;
  readonly palDir: string;
  guardToolCall(
    call: { tool: string; sessionID: string; callID: string },
    output: { args: unknown }
  ): void;
  recordToolCall(
    directory: string,
    call: { tool: string; sessionID: string; callID: string; args: unknown },
    result: { title: string; output: string; metadata: unknown }
  ): void;
  onSessionEvent(type: string): Promise<void>;
  onClose(): Promise<void>;
}

interface V2State {
  bridge: V1Bridge;
  libs: PalLibs;
  ctx: V2Context;
  promptContext: Map<string, string>;
}

function messageText(message: V2SessionMessage): string {
  if (message.type === "user") return (message.text ?? "").trim();

  return (message.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(" ")
    .trim();
}

async function transcript(ctx: V2Context, sessionID: string) {
  const messages = await ctx.session.context({ sessionID });

  return messages
    .filter((m) => m.type === "user" || m.type === "assistant")
    .map((m) => ({ role: m.type, content: messageText(m), id: m.id }))
    .filter((m) => m.content.length > 0);
}

async function runStopHandlers({ libs, ctx }: V2State, sessionID: string) {
  if (libs.isPalSpawnedInference()) return;

  const messages = await transcript(ctx, sessionID);
  libs.logDebug("opencode:idle", `Got ${messages.length} transcript messages`);

  if (messages.length < 2) return;

  const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
  await libs.runStopHandlers(messages, {
    sessionId: sessionID,
    lastAssistantMessage: lastAssistant?.content,
  });
}

function loggedOnFailure<E>(
  libs: PalLibs,
  scope: string,
  cb: V2Callback<E>
): V2Callback<E> {
  return async (event) => {
    try {
      await cb(event);
    } catch (err) {
      libs.logError(scope, err);
    }
  };
}

function guardToolCall({ bridge }: V2State, event: V2ToolCall): void {
  const output = { args: event.input };
  bridge.guardToolCall(
    { tool: event.tool, sessionID: event.sessionID, callID: event.id },
    output
  );
  event.input = output.args;
}

function resultText(event: V2ToolResult): string {
  if (event.status === "error") return event.error?.message ?? "";

  const { output, content } = event.result ?? {};
  if (typeof output === "string") return output;

  return Array.isArray(content)
    ? content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
    : "";
}

function recordToolCall({ bridge, ctx }: V2State, event: V2ToolResult): void {
  bridge.recordToolCall(
    ctx.location.directory,
    { tool: event.tool, sessionID: event.sessionID, callID: event.id, args: event.input },
    { title: "", output: resultText(event), metadata: event.result?.metadata }
  );
}

async function onPrompt({ libs, promptContext }: V2State, event: V2SessionPrompt) {
  const text = event.prompt.text.trim();
  if (libs.isPalSpawnedInference() || !text) return;

  const sentAt = new Date();
  const injectedText = (await libs.getPromptContext(text, event.sessionID)) ?? "";
  libs.logPromptSnapshot(text, injectedText || null);
  await Promise.allSettled([
    libs.captureRating(text, event.sessionID, sentAt),
    libs.captureSessionName(text, event.sessionID),
  ]);

  if (injectedText) promptContext.set(event.sessionID, injectedText);
  else promptContext.delete(event.sessionID);
}

function onContext({ libs, promptContext }: V2State, event: V2SessionContext): void {
  if (libs.isPalSpawnedInference()) return;

  const reminder = libs.buildSystemReminder({
    agent: "opencode",
    sessionId: event.sessionID,
  });
  const injected = promptContext.get(event.sessionID);

  for (const text of [reminder, injected]) {
    if (text) event.system.push({ type: "text", text });
  }
}

function onPermission(libs: PalLibs, event: V2Permission): void {
  if (event.effect !== "ask") return;

  libs.logAttention({
    hook_event_name: "PermissionRequest",
    session_id: event.sessionID,
    tool_name: event.action,
  });
}

async function watchSessions({ bridge, libs, ctx }: V2State, signal: AbortSignal) {
  if (libs.isPalSpawnedInference()) return;

  for await (const event of ctx.event.subscribe({ signal })) {
    if (event.type === "session.created" || event.type === "session.updated") {
      await bridge.onSessionEvent(event.type);
    }
  }
}

async function registerToolHooks(state: V2State): Promise<void> {
  const { libs, ctx, bridge } = state;
  await ctx.tool.hook("execute.before", (event) => guardToolCall(state, event));
  await ctx.tool.hook(
    "execute.after",
    loggedOnFailure(libs, "opencode:tool.after", (event) => recordToolCall(state, event))
  );
  await ctx.permission.hook(
    "evaluate",
    loggedOnFailure(libs, "opencode:permission", (event) => onPermission(libs, event))
  );
  await ctx.shell.hook("create.before", (event) => {
    event.env.PAL_DIR = bridge.palDir;
  });
}

async function registerSessionHooks(state: V2State): Promise<void> {
  const { libs, ctx } = state;
  await ctx.session.hook(
    "prompt",
    loggedOnFailure(libs, "opencode:prompt", (event) => onPrompt(state, event))
  );
  await ctx.session.hook(
    "context",
    loggedOnFailure(libs, "opencode:context", (event) => onContext(state, event))
  );
  await ctx.session.hook(
    "experimental.idle",
    loggedOnFailure(libs, "opencode:session.stop", (event) =>
      runStopHandlers(state, event.sessionID)
    )
  );
}

export async function setupV2(
  ctx: V2Context,
  bridge: V1Bridge
): Promise<() => Promise<void>> {
  const state: V2State = { bridge, libs: bridge.libs, ctx, promptContext: new Map() };
  await registerToolHooks(state);
  await registerSessionHooks(state);

  const watcher = new AbortController();
  watchSessions(state, watcher.signal).catch((err) =>
    bridge.libs.logError("opencode:events", err)
  );

  return async () => {
    watcher.abort();
    await bridge.onClose();
  };
}

/**
 * PAL plugin for opencode — thin adapter over shared hooks/lib/ modules.
 *
 * All business logic lives in hooks/lib/ so it stays in sync with Claude Code hooks.
 * This plugin just wires opencode's hook API to those shared functions.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";

const PAL_DIR = process.env.PAL_DIR || resolve(import.meta.dir, "../../..");

// Force-override (= not ??=): a PAL_AGENT inherited from the parent shell, as when
// opencode starts from a Claude Code terminal, would route inference to that CLI.
process.env.PAL_AGENT = "opencode";

async function lib<T>(mod: string): Promise<T> {
  return await import(resolve(PAL_DIR, "src", "hooks", "lib", mod));
}

type TranscriptMessage = { role: string; content: string; id?: string };

function isSessionEvent(type: string): boolean {
  return type.startsWith("session.");
}

type OpencodeEvent = Parameters<NonNullable<Hooks["event"]>>[0]["event"];
type ChatMessageArgs = Parameters<NonNullable<Hooks["chat.message"]>>;
type ShellCallOutput = { args: Record<string, unknown> | string };
type ToolCallInput = { tool: string; sessionID: string; callID: string; args: unknown };
type ToolCallOutput = { title: string; output: string; metadata: unknown };

// `rtk hook check <cmd>` prints the rewritten command (exit 0), or nothing
// (exit 1) when a command isn't worth wrapping.
function rtkRewriter(rtkBin: string | null) {
  return (cmd: string): string | null => {
    if (!rtkBin || !cmd) return null;

    try {
      const r = spawnSync(rtkBin, ["hook", "check", cmd], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const out = r.status === 0 ? (r.stdout ?? "").trim() : "";

      return out && out !== cmd ? out : null;
    } catch {
      return null;
    }
  };
}

async function loadGuardLibs() {
  const { buildSystemReminder } =
    await lib<typeof import("../../hooks/lib/context")>("context.ts");
  const { checkBashCommand, checkFilePath } =
    await lib<typeof import("../../hooks/lib/security")>("security.ts");
  const { findBinaryOnPath } =
    await lib<typeof import("../../hooks/lib/which")>("which.ts");
  const { isPalSpawnedInference } =
    await lib<typeof import("../../hooks/lib/spawn-guard")>("spawn-guard.ts");

  return {
    buildSystemReminder,
    checkBashCommand,
    checkFilePath,
    isPalSpawnedInference,
    rtkRewrite: rtkRewriter(findBinaryOnPath("rtk")),
  };
}

async function loadLoggingLibs() {
  const { logDebug, logError, logPromptSnapshot } =
    await lib<typeof import("../../hooks/lib/log")>("log.ts");
  const { logToolCall } =
    await lib<typeof import("../../hooks/lib/tool-events")>("tool-events.ts");
  const { recordSlurpCheck } =
    await lib<typeof import("../../hooks/lib/slurp-check")>("slurp-check.ts");
  const { attachProgressFromToolCall } = await lib<
    typeof import("../../hooks/lib/progress-tree-tool")
  >("progress-tree-tool.ts");
  const { logAttention } =
    await lib<typeof import("../../hooks/lib/attention-events")>("attention-events.ts");
  const { commitApplied, ledgeredTarget, snapshotCall } =
    await lib<typeof import("../../hooks/lib/ledger-hook")>("ledger-hook.ts");

  return {
    attachProgressFromToolCall,
    commitApplied,
    ledgeredTarget,
    logAttention,
    logDebug,
    logError,
    logPromptSnapshot,
    logToolCall,
    recordSlurpCheck,
    snapshotCall,
  };
}

async function loadTurnLibs() {
  const { runStopHandlers } = await lib<typeof import("../../hooks/lib/stop")>("stop.ts");
  const opencodeEvents =
    await lib<typeof import("../../hooks/lib/opencode-events")>("opencode-events.ts");
  const { captureSessionName } = await lib<
    typeof import("../../hooks/handlers/session-name")
  >("../handlers/session-name.ts");
  const { captureRating } = await lib<typeof import("../../hooks/handlers/rating")>(
    "../handlers/rating.ts"
  );
  const { getPromptContext } = await lib<
    typeof import("../../hooks/handlers/inject-retrieval")
  >("../handlers/inject-retrieval.ts");

  return {
    captureRating,
    captureSessionName,
    getPromptContext,
    logOpencodeCompaction: opencodeEvents.logOpencodeCompaction,
    logOpencodePermissionReply: opencodeEvents.logOpencodePermissionReply,
    logOpencodeSessionCreated: opencodeEvents.logOpencodeSessionCreated,
    logOpencodeToolFailure: opencodeEvents.logOpencodeToolFailure,
    rememberAskedTool: opencodeEvents.rememberAskedTool,
    runStopHandlers,
  };
}

async function loadPalLibs() {
  const guards = await loadGuardLibs();
  const logging = await loadLoggingLibs();
  const turns = await loadTurnLibs();

  return { ...guards, ...logging, ...turns };
}

type PalLibs = Awaited<ReturnType<typeof loadPalLibs>>;

interface PluginContext {
  libs: PalLibs;
  client: PluginInput["client"];
  directory: string;
}

function partsToText(parts: Array<Record<string, unknown>>): string {
  return parts
    .filter((p) => p?.type === "text" && !p.ignored && !p.synthetic)
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join(" ")
    .trim();
}

async function buildSessionTranscript(
  { libs, client, directory }: PluginContext,
  sessionID: string
): Promise<TranscriptMessage[]> {
  const result = await client.session.messages({
    path: { id: sessionID },
    query: { directory },
  });

  if (result.error || !result.data) {
    libs.logDebug(
      "opencode:session.messages",
      `Failed to fetch messages (error=${Boolean(result.error)})`
    );

    return [];
  }

  const rows = result.data as Array<{
    info: { role?: string; id?: string };
    parts: Array<Record<string, unknown>>;
  }>;

  return rows
    .map((row) => {
      const role = row?.info?.role ?? "unknown";
      const content = partsToText(row?.parts ?? []);

      return { role, content, id: row?.info?.id };
    })
    .filter((m) => m.content.length > 0);
}

async function runStopHandlersOnIdle(ctx: PluginContext, event: unknown): Promise<void> {
  const { logDebug, runStopHandlers } = ctx.libs;
  const sessionID = (event as { properties?: { sessionID?: string } })?.properties
    ?.sessionID;
  if (!sessionID) {
    logDebug("opencode:event", "Skipping stop handlers: missing sessionID");

    return;
  }

  const messages = await buildSessionTranscript(ctx, sessionID);
  logDebug("opencode:event", `Got ${messages.length} transcript messages`);

  if (messages.length < 2) return;

  // Last assistant message feeds response caching (parity with Claude Code).
  const lastAssistant = messages
    .filter((m: TranscriptMessage) => m.role === "assistant")
    .pop();

  await runStopHandlers(messages, {
    sessionId: sessionID,
    lastAssistantMessage: lastAssistant?.content,
  });
  logDebug("opencode:event", "Stop handlers complete");
}

function guardShellCall(libs: PalLibs, output: ShellCallOutput): void {
  const cmd =
    typeof output.args === "string"
      ? output.args
      : ((output.args?.command as string) ?? "");
  const reason = libs.checkBashCommand(cmd);
  if (reason) {
    throw new Error(`PAL Security: Blocked — ${reason}`);
  }

  const rewritten = libs.rtkRewrite(cmd);
  if (!rewritten) return;

  if (typeof output.args === "string") output.args = rewritten;
  else (output.args as Record<string, unknown>).command = rewritten;
}

function guardFileWrite(libs: PalLibs, args: Record<string, string>): void {
  const filePath = args?.file_path ?? args?.filePath ?? args?.path ?? "";
  const fileReason = libs.checkFilePath(filePath);
  if (fileReason) {
    throw new Error(`PAL Security: ${fileReason}`);
  }
}

function logEventDetails(libs: PalLibs, event: OpencodeEvent): void {
  if (event.type === "session.created")
    libs.logOpencodeSessionCreated(event.properties.info);

  if (event.type === "session.compacted")
    libs.logOpencodeCompaction(event.properties.sessionID);

  if (event.type === "permission.replied")
    libs.logOpencodePermissionReply(event.properties);

  if (event.type === "message.part.updated")
    libs.logOpencodeToolFailure(event.properties.part);
}

async function onSessionOpenedOrUpdated(event: OpencodeEvent): Promise<void> {
  if (event.type === "session.created") {
    const { heartbeatOnStart } =
      await lib<typeof import("../../hooks/lib/telemetry")>("telemetry.ts");
    heartbeatOnStart();
  }

  if (event.type === "session.created" || event.type === "session.updated") {
    const { regenerateIfNeeded } =
      await lib<typeof import("../../hooks/lib/claude-md")>("claude-md.ts");
    regenerateIfNeeded();
  }
}

function ledgeredOpencodeCall(
  libs: PalLibs,
  tool: string,
  callID: string,
  args: unknown
) {
  const target = libs.ledgeredTarget(tool, (args ?? {}) as Record<string, unknown>);

  return target ? { toolUseId: callID, tool, target } : null;
}

async function autoUpdateOnDispose(event: OpencodeEvent): Promise<void> {
  if (event.type === "server.instance.disposed") {
    const { autoUpdateOnClose } =
      await lib<typeof import("../../hooks/lib/auto-update")>("auto-update.ts");
    autoUpdateOnClose();
  }
}

async function onEvent(ctx: PluginContext, event: OpencodeEvent): Promise<void> {
  const { libs } = ctx;
  if (libs.isPalSpawnedInference()) return;

  if (isSessionEvent(event.type)) libs.logDebug("opencode:event", `Event: ${event.type}`);

  await autoUpdateOnDispose(event);
  logEventDetails(libs, event);
  await onSessionOpenedOrUpdated(event);

  if (event.type === "session.idle") {
    libs.logDebug("opencode:event", "Running stop handlers...");

    try {
      await runStopHandlersOnIdle(ctx, event);
    } catch (err) {
      libs.logError("opencode:session.stop", err);
    }
  }
}

function prependInjectedPart(
  [input, output]: ChatMessageArgs,
  injectedText: string
): void {
  const injected = {
    id: `pal-promptctx-${Date.now()}`,
    sessionID: input.sessionID,
    messageID: input.messageID ?? `pal-msg-${Date.now()}`,
    type: "text" as const,
    text: injectedText,
    synthetic: true,
  };
  output.parts = [injected, ...(output.parts ?? [])];
}

async function onChatMessage(libs: PalLibs, ...args: ChatMessageArgs): Promise<void> {
  const [input, output] = args;

  if (libs.isPalSpawnedInference()) return;
  const text = partsToText(output.parts ?? []);
  if (!text.trim()) return;

  const sentAt = new Date();
  const injectedText = (await libs.getPromptContext(text, input.sessionID)) ?? "";
  libs.logPromptSnapshot(text, injectedText || null);

  await Promise.allSettled([
    libs.captureRating(text, input.sessionID, sentAt),
    libs.captureSessionName(text, input.sessionID),
  ]);

  if (injectedText) prependInjectedPart(args, injectedText);
}

function beforeToolCall(
  libs: PalLibs,
  input: { tool: string; sessionID: string; callID: string },
  output: ShellCallOutput
): void {
  const toolName = input.tool;
  if (toolName === "shell" || toolName === "bash") guardShellCall(libs, output);

  if (toolName === "write" || toolName === "edit" || toolName === "patch") {
    guardFileWrite(libs, output.args as Record<string, string>);
  }

  const call = ledgeredOpencodeCall(libs, toolName, input.callID, output.args);
  if (call) libs.snapshotCall(call);
}

function toolCallRecord(input: ToolCallInput, output: ToolCallOutput) {
  return {
    tool_name: input.tool,
    tool_input: input.args,
    session_id: input.sessionID,
    tool_response: output?.output,
  };
}

function toolCallRecordWithExit(input: ToolCallInput, output: ToolCallOutput) {
  return {
    ...toolCallRecord(input, output),
    exit_code: (output?.metadata as { exit?: unknown } | undefined)?.exit,
  };
}

function afterToolCall(
  { libs, directory }: PluginContext,
  input: ToolCallInput,
  output: ToolCallOutput
): void {
  libs.logToolCall(toolCallRecord(input, output));
  libs.recordSlurpCheck(toolCallRecordWithExit(input, output), directory);
  libs.attachProgressFromToolCall(toolCallRecordWithExit(input, output), directory);
  const call = ledgeredOpencodeCall(libs, input.tool, input.callID, input.args);
  if (!call) return;

  const entry = libs.commitApplied(call);
  if (entry) libs.logDebug("opencode:ledger", `recorded ${entry.id} ${entry.target}`);
}

function palHooks(ctx: PluginContext): Hooks {
  const { libs } = ctx;

  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (libs.isPalSpawnedInference()) return;
      const reminder = libs.buildSystemReminder({
        agent: "opencode",
        sessionId: input.sessionID,
      });
      if (reminder) output.system.push(reminder);
    },
    event: ({ event }) => onEvent(ctx, event),
    "chat.message": (input, output) => onChatMessage(libs, input, output),
    "tool.execute.before": async (input, output: ShellCallOutput) =>
      beforeToolCall(libs, input, output),
    "permission.ask": async (input) => {
      libs.rememberAskedTool(input);
      libs.logAttention({
        hook_event_name: "PermissionRequest",
        session_id: input.sessionID,
        tool_name: input.type,
      });
    },
    "tool.execute.after": async (input, output) =>
      afterToolCall(ctx, input as ToolCallInput, output as ToolCallOutput),
    "shell.env": async (input, output) => {
      output.env.PAL_DIR = PAL_DIR;

      if (input.sessionID) output.env.PAL_OPENCODE_SESSION_ID = input.sessionID;
    },
  };
}

const PALPlugin: Plugin = async ({ directory, client }: PluginInput) => {
  const libs = await loadPalLibs();

  return palHooks({ libs, client, directory });
};

export default PALPlugin;

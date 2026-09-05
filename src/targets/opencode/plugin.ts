/**
 * PAL plugin for opencode — thin adapter over shared hooks/lib/ modules.
 *
 * All business logic lives in hooks/lib/ so it stays in sync with Claude Code hooks.
 * This plugin just wires opencode's hook API to those shared functions.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { Plugin, PluginInput } from "@opencode-ai/plugin";

const PAL_DIR = process.env.PAL_DIR || resolve(import.meta.dir, "../../..");

// Identify ourselves as opencode for the shared detector in hooks/lib/agent.ts.
// Force-override (= not ??=) so an inherited PAL_AGENT from the parent shell
// — common when launching opencode from a Claude Code terminal — doesn't make
// the dispatcher route inference to the wrong agent's CLI. Mirrors how
// .claude/settings.json template prefixes every hook command with PAL_AGENT=claude.
process.env.PAL_AGENT = "opencode";

// Dynamic imports from shared lib — resolved at runtime via PAL_DIR
async function lib<T>(mod: string): Promise<T> {
  return await import(resolve(PAL_DIR, "src", "hooks", "lib", mod));
}

type TranscriptMessage = { role: string; content: string };

const PALPlugin: Plugin = async ({ directory, client }: PluginInput) => {
  // Pre-load shared modules
  const { buildSystemReminder } =
    await lib<typeof import("../../hooks/lib/context")>("context.ts");
  const { checkBashCommand, checkFilePath } =
    await lib<typeof import("../../hooks/lib/security")>("security.ts");
  const { findBinaryOnPath } =
    await lib<typeof import("../../hooks/lib/which")>("which.ts");

  // rtk output compression — PAL gates on presence, rtk owns the rewrite.
  // `rtk hook check <cmd>` prints the rewritten command (exit 0) or nothing
  // (exit 1) when a command isn't worth wrapping. Fail-open: absent rtk or any
  // error leaves the command untouched.
  const rtkBin = findBinaryOnPath("rtk");
  const rtkRewrite = (cmd: string): string | null => {
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
  const { logDebug, logError, logPromptSnapshot } =
    await lib<typeof import("../../hooks/lib/log")>("log.ts");

  // Load shared handlers
  const { runStopHandlers } = await lib<typeof import("../../hooks/lib/stop")>("stop.ts");
  const { captureSessionName } = await lib<
    typeof import("../../hooks/handlers/session-name")
  >("../handlers/session-name.ts");
  const { captureRating } = await lib<typeof import("../../hooks/handlers/rating")>(
    "../handlers/rating.ts"
  );
  const { getPromptContext } = await lib<
    typeof import("../../hooks/handlers/inject-retrieval")
  >("../handlers/inject-retrieval.ts");

  function partsToText(parts: Array<Record<string, unknown>>): string {
    return parts
      .filter((p) => p?.type === "text" && !p.ignored && !p.synthetic)
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join(" ")
      .trim();
  }

  async function buildSessionTranscript(sessionID: string): Promise<TranscriptMessage[]> {
    const result = await client.session.messages({
      path: { id: sessionID },
      query: { directory },
    });

    if (result.error || !result.data) {
      logDebug(
        "opencode:session.messages",
        `Failed to fetch messages (error=${Boolean(result.error)})`
      );
      return [];
    }

    const rows = result.data as Array<{
      info: { role?: string };
      parts: Array<Record<string, unknown>>;
    }>;

    return rows
      .map((row) => {
        const role = row?.info?.role ?? "unknown";
        const content = partsToText(row?.parts ?? []);
        return { role, content };
      })
      .filter((m) => m.content.length > 0);
  }

  const { isPalSpawnedInference } =
    await lib<typeof import("../../hooks/lib/spawn-guard")>("spawn-guard.ts");

  const { commitApplied, ledgeredTarget, snapshotCall } =
    await lib<typeof import("../../hooks/lib/ledger-hook")>("ledger-hook.ts");

  const ledgeredOpencodeCall = (tool: string, callID: string, args: unknown) => {
    const target = ledgeredTarget(tool, (args ?? {}) as Record<string, unknown>);
    return target ? { toolUseId: callID, tool, target } : null;
  };

  return {
    // --- Per-message: Inject dynamic system reminder ---
    "experimental.chat.system.transform": async (_input, output) => {
      if (isPalSpawnedInference()) return;
      const reminder = buildSystemReminder({ agent: "opencode" });
      if (reminder) output.system.push(reminder);
    },

    // --- Session events: start and stop handling ---
    event: async ({ event }) => {
      if (isPalSpawnedInference()) return;
      logDebug("opencode:event", `Event: ${event.type}`);

      if (event.type === "session.created" || event.type === "session.updated") {
        const { regenerateIfNeeded } =
          await lib<typeof import("../../hooks/lib/claude-md")>("claude-md.ts");
        regenerateIfNeeded();
      }

      if (event.type === "session.idle" || event.type === "session.diff") {
        logDebug("opencode:event", "Running stop handlers...");
        try {
          const sessionID = (event as { properties?: { sessionID?: string } })?.properties
            ?.sessionID;
          if (!sessionID) {
            logDebug("opencode:event", "Skipping stop handlers: missing sessionID");
            return;
          }

          const messages = await buildSessionTranscript(sessionID);
          logDebug("opencode:event", `Got ${messages.length} transcript messages`);
          if (messages.length < 2) return;

          // Extract last assistant message for response caching (parity with Claude Code)
          const lastAssistant = messages
            .filter((m: TranscriptMessage) => m.role === "assistant")
            .pop();

          await runStopHandlers(JSON.stringify(messages), {
            sessionId: sessionID,
            lastAssistantMessage: lastAssistant?.content,
          });
          logDebug("opencode:event", "Stop handlers complete");
        } catch (err) {
          logError("opencode:session.stop", err);
        }
      }
    },

    // --- Capture ratings + session naming from user messages (shared handlers) ---
    "chat.message": async (input, output) => {
      if (isPalSpawnedInference()) return;
      const text = partsToText(output.parts ?? []);
      if (!text.trim()) return;

      const injectedText = (await getPromptContext(text)) ?? "";
      logPromptSnapshot(text, injectedText || null);

      await Promise.allSettled([
        captureRating(text, input.sessionID),
        captureSessionName(text, input.sessionID),
      ]);

      if (injectedText) {
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
    },

    // --- Security: block dangerous tool executions ---
    "tool.execute.before": async (
      _input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> | string }
    ) => {
      const toolName = _input.tool;

      if (toolName === "shell" || toolName === "bash") {
        const cmd =
          typeof output.args === "string"
            ? output.args
            : ((output.args?.command as string) ?? "");
        const reason = checkBashCommand(cmd);
        if (reason) {
          throw new Error(`PAL Security: Blocked — ${reason}`);
        }
        const rewritten = rtkRewrite(cmd);
        if (rewritten) {
          if (typeof output.args === "string") output.args = rewritten;
          else (output.args as Record<string, unknown>).command = rewritten;
        }
      }

      if (toolName === "write" || toolName === "edit" || toolName === "patch") {
        const args = output.args as Record<string, string>;
        const filePath = args?.file_path ?? args?.filePath ?? args?.path ?? "";
        const fileReason = checkFilePath(filePath);
        if (fileReason) {
          throw new Error(`PAL Security: ${fileReason}`);
        }
      }

      const call = ledgeredOpencodeCall(toolName, _input.callID, output.args);
      if (call) snapshotCall(call);
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: unknown },
      _output: { title: string; output: string; metadata: unknown }
    ) => {
      const call = ledgeredOpencodeCall(input.tool, input.callID, input.args);
      if (!call) return;

      const entry = commitApplied(call);
      if (entry) logDebug("opencode:ledger", `recorded ${entry.id} ${entry.target}`);
    },

    // --- Inject PAL_DIR into shell environment ---
    "shell.env": async (
      _input: { cwd: string; sessionID?: string; callID?: string },
      output: { env: Record<string, string> }
    ) => {
      output.env.PAL_DIR = PAL_DIR;
    },
  };
};

export default PALPlugin;

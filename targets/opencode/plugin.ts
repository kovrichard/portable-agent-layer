/**
 * PAI plugin for opencode — thin adapter over shared hooks/lib/ modules.
 *
 * All business logic lives in hooks/lib/ so it stays in sync with Claude Code hooks.
 * This plugin just wires opencode's hook API to those shared functions.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin, PluginInput } from "@opencode-ai/plugin";

const PAI_DIR = process.env.PAI_DIR || resolve(import.meta.dir, "../..");

// Dynamic imports from shared lib — resolved at runtime via PAI_DIR
async function lib<T>(mod: string): Promise<T> {
  return await import(resolve(PAI_DIR, "hooks", "lib", mod));
}

type TranscriptMessage = { role: string; content: string };

const PAIPlugin: Plugin = async ({ directory, client }: PluginInput) => {
  // Pre-load shared modules
  const { buildGreeting, buildSystemReminder } =
    await lib<typeof import("../../hooks/lib/context")>("context.ts");
  const { checkBashCommand, checkFilePath } =
    await lib<typeof import("../../hooks/lib/security")>("security.ts");
  const { paths, ensureDir } =
    await lib<typeof import("../../hooks/lib/paths")>("paths.ts");
  const { emitRating } =
    await lib<typeof import("../../hooks/lib/signals")>("signals.ts");
  const { now } = await lib<typeof import("../../hooks/lib/time")>("time.ts");
  const { monthPath, fileTimestamp } =
    await lib<typeof import("../../hooks/lib/time")>("time.ts");
  const { logDebug, logError } =
    await lib<typeof import("../../hooks/lib/log")>("log.ts");

  // Load shared stop-orchestrator handler
  const { runStopHandlers } = await lib<typeof import("../../hooks/lib/stop")>("stop.ts");
  const { captureSessionName } = await lib<
    typeof import("../../hooks/handlers/session-name")
  >("../handlers/session-name.ts");

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

  // Local helpers for rating (thin wrappers around shared signals)
  function handleRating(rating: number, context: string, source: string): void {
    emitRating(rating, context, source);

    if (rating < 6) {
      const dir = ensureDir(resolve(paths.learning(), "low-ratings", monthPath()));
      writeFileSync(
        resolve(dir, `${fileTimestamp()}.md`),
        `# Low Rating: ${rating}/10\n**Source:** ${source}\n**User said:** ${context}\n\n## What went wrong?\n\n## What should be done differently?\n`
      );
    }
  }

  const PRAISE_PATTERNS =
    /^(great\s*job|nice|perfect|awesome|excellent|thanks|thank\s*you|well\s*done|good\s*job|love\s*it|amazing|brilliant|fantastic|wonderful|superb|nailed\s*it)[.!?]?$/i;

  return {
    // --- Per-message: Inject dynamic system reminder ---
    "experimental.chat.system.transform": async (_input, output) => {
      const reminder = buildSystemReminder();
      if (reminder) output.system.push(reminder);
    },

    // --- Session events: start and stop handling ---
    event: async ({ event }) => {
      logDebug("opencode:event", `Event: ${event.type}`);

      if (event.type === "session.created" || event.type === "session.updated") {
        const { regenerateIfNeeded } =
          await lib<typeof import("../../hooks/lib/claude-md")>("claude-md.ts");
        regenerateIfNeeded();
        console.log(buildGreeting().join("\n"));
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

          // Name session from first user message (if not already named)
          const firstUser = messages.find((m: TranscriptMessage) => m.role === "user");
          if (firstUser) {
            await captureSessionName(firstUser.content, sessionID);
          }

          await runStopHandlers(JSON.stringify(messages), { sessionId: sessionID });
          logDebug("opencode:event", "Stop handlers complete");
        } catch (err) {
          logError("opencode:session.stop", err);
        }
      }
    },

    // --- Capture ratings from user messages ---
    "chat.message": async (_input, output) => {
      const text =
        output.parts
          ?.filter((p) => p.type === "text")
          .map((p) => p.text || "")
          .join(" ") ?? "";

      // Explicit rating
      const match = text.match(
        /(?:^|rating:?\s*|score:?\s*)(\d|10)(?:\s*(?:\/10|[-.])|$|\s)/i
      );
      if (match) {
        const rating = parseInt(match[1], 10);
        if (rating >= 1 && rating <= 10) {
          handleRating(rating, text.slice(0, 200), "explicit");
          return;
        }
      }

      // Implicit sentiment: auto-enabled when ANTHROPIC_API_KEY is set
      if (process.env.ANTHROPIC_API_KEY) {
        const trimmed = text.trim();
        if (PRAISE_PATTERNS.test(trimmed)) {
          handleRating(8, trimmed, "implicit");
          return;
        }

        // Full implicit via API — only for medium-length messages
        if (
          trimmed.length >= 5 &&
          trimmed.length <= 500 &&
          !/^[/$`{]/.test(trimmed) &&
          !trimmed.includes("\n\n")
        ) {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (apiKey) {
            try {
              const response = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                  "x-api-key": apiKey,
                  "anthropic-version": "2023-06-01",
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  model: "claude-haiku-4-5-20251001",
                  max_tokens: 100,
                  messages: [
                    {
                      role: "user",
                      content: `Rate the sentiment of this user message toward an AI assistant on a 1-10 scale (1=very negative, 5=neutral, 10=very positive). If the message has no clear sentiment toward the assistant, respond with just "neutral". Otherwise respond with just a JSON object: {"rating": N, "sentiment": "one-word"}\n\nMessage: "${trimmed.slice(0, 300)}"`,
                    },
                  ],
                }),
              });

              if (response.ok) {
                const data = (await response.json()) as {
                  content?: Array<{ text?: string }>;
                };
                const rText = data?.content?.[0]?.text?.trim();
                if (rText && rText !== "neutral") {
                  try {
                    const parsed = JSON.parse(rText) as {
                      rating?: number;
                      sentiment?: string;
                    };
                    if (
                      typeof parsed.rating === "number" &&
                      parsed.rating >= 1 &&
                      parsed.rating <= 10 &&
                      parsed.rating !== 5
                    ) {
                      handleRating(
                        parsed.rating,
                        `${parsed.sentiment || "inferred"}: ${trimmed.slice(0, 150)}`,
                        "implicit"
                      );
                    }
                  } catch {
                    // Ignore parse errors
                  }
                }
              }
            } catch {
              // Ignore API errors
            }
          }
        }
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
          throw new Error(`PAI Security: Blocked — ${reason}`);
        }
      }

      if (toolName === "write" || toolName === "edit" || toolName === "patch") {
        const args = output.args as Record<string, string>;
        const filePath = args?.file_path ?? args?.filePath ?? args?.path ?? "";
        if (checkFilePath(filePath)) {
          throw new Error(`PAI Security: Protected path — ${filePath}`);
        }
      }
    },

    // --- Capture work state after tool use ---
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: unknown },
      _output: { title: string; output: string; metadata: unknown }
    ) => {
      try {
        writeFileSync(
          resolve(ensureDir(paths.state()), "current-work.json"),
          JSON.stringify({ ts: now(), tool: input.tool, cwd: directory }, null, 2)
        );
      } catch {
        // Ignore write errors
      }
    },

    // --- Inject PAI_DIR into shell environment ---
    "shell.env": async (
      _input: { cwd: string; sessionID?: string; callID?: string },
      output: { env: Record<string, string> }
    ) => {
      output.env.PAI_DIR = PAI_DIR;
      if (process.env.PAI_DEBUG) {
        output.env.PAI_DEBUG = process.env.PAI_DEBUG;
      }
    },
  };
};

export default PAIPlugin;

/**
 * PAI plugin for opencode — thin adapter over shared hooks/lib/ modules.
 *
 * All business logic lives in hooks/lib/ so it stays in sync with Claude Code hooks.
 * This plugin just wires opencode's hook API to those shared functions.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { resolve } from "path";
import { writeFileSync } from "fs";

const PAI_DIR = process.env.PAI_DIR || resolve(import.meta.dir, "../..");

// Dynamic imports from shared lib — resolved at runtime via PAI_DIR
async function lib<T>(mod: string): Promise<T> {
  return await import(resolve(PAI_DIR, "hooks", "lib", mod));
}

const PAIPlugin: Plugin = async ({ directory }) => {
  // Pre-load shared modules
  const { loadTelos, loadActiveWork, countSignals, buildGreeting } = await lib<
    typeof import("../../hooks/lib/context")
  >("context.ts");
  const { readSetupState, buildSetupPrompt, STEP_ORDER } = await lib<
    typeof import("../../hooks/lib/setup")
  >("setup.ts");
  const { checkBashCommand, checkFilePath } = await lib<
    typeof import("../../hooks/lib/security")
  >("security.ts");
  const { paths, ensureDir } = await lib<
    typeof import("../../hooks/lib/paths")
  >("paths.ts");
  const { emitRating } = await lib<
    typeof import("../../hooks/lib/signals")
  >("signals.ts");
  const { now } = await lib<typeof import("../../hooks/lib/time")>("time.ts");
  const { monthPath, fileTimestamp } = await lib<
    typeof import("../../hooks/lib/time")
  >("time.ts");

  // Local helpers for rating (thin wrappers around shared signals)
  function handleRating(rating: number, context: string, source: string): void {
    emitRating(rating, context, source);

    if (rating < 6) {
      const dir = ensureDir(
        resolve(paths.learning(), "low-ratings", monthPath())
      );
      writeFileSync(
        resolve(dir, `${fileTimestamp()}.md`),
        `# Low Rating: ${rating}/10\n**Source:** ${source}\n**User said:** ${context}\n\n## What went wrong?\n\n## What should be done differently?\n`
      );
    }
  }

  const PRAISE_PATTERNS =
    /^(great\s*job|nice|perfect|awesome|excellent|thanks|thank\s*you|well\s*done|good\s*job|love\s*it|amazing|brilliant|fantastic|wonderful|superb|nailed\s*it)[.!]?$/i;

  return {
    // --- Inject TELOS context + setup instructions into system prompt ---
    "experimental.chat.system.transform": async (_input, output) => {
      const telos = loadTelos();
      const work = loadActiveWork();
      const setupState = readSetupState();
      const setupPrompt = setupState ? buildSetupPrompt(setupState) : null;

      const ctxParts = ["# Personal Context (TELOS)"];
      if (setupPrompt) ctxParts.push(setupPrompt);
      if (telos) ctxParts.push(telos);
      if (work) ctxParts.push("", work.text);

      output.system.push(ctxParts.join("\n"));

      // Prepend status greeting
      output.system.unshift(buildGreeting().join("\n"));
    },

    // --- Capture ratings from user messages ---
    "chat.message": async (_input, output) => {
      const text =
        output.parts
          ?.filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
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

      // Implicit sentiment (opt-in)
      if (process.env.PAI_IMPLICIT_SENTIMENT === "1") {
        const trimmed = text.trim();
        if (PRAISE_PATTERNS.test(trimmed)) {
          handleRating(8, trimmed, "implicit");
          return;
        }

        // Full implicit via API — only for medium-length messages
        if (
          trimmed.length >= 5 &&
          trimmed.length <= 500 &&
          !/^[\/\$`{]/.test(trimmed) &&
          !trimmed.includes("\n\n")
        ) {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (apiKey) {
            try {
              const response = await fetch(
                "https://api.anthropic.com/v1/messages",
                {
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
                }
              );

              if (response.ok) {
                const data = (await response.json()) as any;
                const rText = data?.content?.[0]?.text?.trim();
                if (rText && rText !== "neutral") {
                  try {
                    const parsed = JSON.parse(rText);
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
                  } catch {}
                }
              }
            } catch {}
          }
        }
      }
    },

    // --- Security: block dangerous tool executions ---
    "tool.execute.before": async (_input, output) => {
      const toolName = _input.tool;

      if (toolName === "shell" || toolName === "bash") {
        const cmd =
          typeof output.args === "string"
            ? output.args
            : (output.args?.command ?? "");
        const reason = checkBashCommand(cmd);
        if (reason) {
          throw new Error(`PAI Security: Blocked — ${reason}`);
        }
      }

      if (
        toolName === "write" ||
        toolName === "edit" ||
        toolName === "patch"
      ) {
        const filePath =
          output.args?.file_path ??
          output.args?.filePath ??
          output.args?.path ??
          "";
        if (checkFilePath(filePath)) {
          throw new Error(`PAI Security: Protected path — ${filePath}`);
        }
      }
    },

    // --- Capture work state after tool use ---
    "tool.execute.after": async (input, _output) => {
      try {
        writeFileSync(
          resolve(ensureDir(paths.state()), "current-work.json"),
          JSON.stringify(
            { ts: now(), tool: input.tool, cwd: directory },
            null,
            2
          )
        );
      } catch {}
    },

    // --- Inject PAI_DIR into shell environment ---
    "shell.env": async (_input, output) => {
      output.env.PAI_DIR = PAI_DIR;
    },
  };
};

export default PAIPlugin;

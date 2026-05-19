/**
 * Failure-principle handler — extracts an actionable principle from a low-rated
 * session via inference, then persists the failure record.
 *
 * Detached from the Stop hook (lib/stop.ts) because claude --print cold-start
 * can exceed the Stop hook's reasonable budget. Parent writes pending data +
 * transcript to tmp files, spawns this script with both paths, and returns
 * immediately. Child reads, runs inference, calls captureFailure, and unlinks
 * the tmp files.
 */

import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { extractContent, parseMessages } from "../lib/transcript";
import { captureFailure } from "./failure";

interface PendingFailure {
  rating: number;
  context: string;
  detailedContext?: string;
  principle?: string;
  responsePreview?: string;
  userPreview?: string;
  cwd?: string;
}

/**
 * Inference the principle (if missing) and persist the failure record.
 * Reads pending data + transcript from the provided tmp paths and unlinks them.
 */
async function processFailurePrinciple(
  pendingPath: string,
  transcriptPath: string
): Promise<void> {
  const { logDebug, logError } = await import("../lib/log");
  try {
    if (!existsSync(pendingPath) || !existsSync(transcriptPath)) {
      logError(
        "failure-principle",
        `missing input: pending=${existsSync(pendingPath)} transcript=${existsSync(transcriptPath)}`
      );
      return;
    }

    const pending = JSON.parse(await readFile(pendingPath, "utf-8")) as PendingFailure;
    const transcript = await readFile(transcriptPath, "utf-8");
    logDebug("failure-principle", `processing rating=${pending.rating}`);

    let { principle, detailedContext } = pending;
    if (!principle) {
      try {
        const { inference } = await import("../lib/inference");
        const msgs = parseMessages(transcript);
        const recent = msgs
          .slice(-10)
          .map((m) => `${m.role.toUpperCase()}: ${extractContent(m).slice(0, 300)}`)
          .join("\n\n");

        const result = await inference({
          system: `Analyze this failed AI interaction. The user rated it ${pending.rating}/10.

Return JSON:
{
  "principle": "<one actionable rule the AI should follow, 10-20 words. Start with a verb: 'Verify...', 'Always...', 'Never...', 'Ask before...'>",
  "detailed_context": "<what went wrong and why, 50-150 words>"
}`,
          user: `User feedback: ${pending.context}\n\nConversation:\n${recent}`,
          maxTokens: 400,
          timeout: 60000,
          jsonSchema: {
            type: "object" as const,
            properties: {
              principle: { type: "string" as const },
              detailed_context: { type: "string" as const },
            },
            required: ["principle", "detailed_context"],
            additionalProperties: false,
          },
        });

        if (result.success && result.output) {
          const parsed = JSON.parse(result.output) as {
            principle?: string;
            detailed_context?: string;
          };
          principle = parsed.principle || undefined;
          detailedContext ??= parsed.detailed_context || undefined;
        } else {
          logError("failure-principle", `inference failed (no output)`);
        }
      } catch (err) {
        logError("failure-principle:inference", err);
      }
    }

    await captureFailure(
      pending.rating,
      pending.context,
      transcript,
      detailedContext,
      principle,
      pending.cwd
    );
    logDebug("failure-principle", "captureFailure done");
  } catch (err) {
    logError("failure-principle", err);
  } finally {
    await unlink(pendingPath).catch(() => {});
    await unlink(transcriptPath).catch(() => {});
  }
}

// Detached child entry point
if (process.argv[2] === "--run") {
  const pendingPath = process.argv[3];
  const transcriptPath = process.argv[4];
  if (pendingPath && transcriptPath) {
    await processFailurePrinciple(pendingPath, transcriptPath);
  }
  process.exit(0);
}

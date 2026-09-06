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
import {
  mergeInferredPrinciple,
  needsInference,
  type PendingFailure,
  principleRequest,
  recentExchange,
} from "../lib/failure-principle";
import { captureFailure } from "./failure";

/**
 * Inference the principle (if missing) and persist the failure record.
 * Reads pending data + transcript from the provided tmp paths and unlinks them.
 *
 * @lintignore exercised directly by test/failure-principle.test.ts
 */
export async function processFailurePrinciple(
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
    if (needsInference(pending)) {
      try {
        const { inference } = await import("../lib/inference");
        const result = await inference(
          principleRequest(pending, recentExchange(transcript))
        );
        if (!result.success || !result.output) {
          logError("failure-principle", `inference failed (no output)`);
        }
        ({ principle, detailedContext } = mergeInferredPrinciple(
          pending,
          result.output ?? null
        ));
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

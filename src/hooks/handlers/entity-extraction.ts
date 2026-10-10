/**
 * Stop handler: learn the people and companies the user mentioned since the last
 * stop, so the prompt-time cards know them next time, and look the new ones up on
 * Wikipedia for review. Runs detached; one extraction call, only when the new text
 * names someone, and one call per entry looked up.
 */

import { ingestEntities } from "../../tools/knowledge/ingest";
import { excludedNames, loadKnownEntities, loadNameIndex } from "../lib/entity-cards";
import {
  extractionSchema,
  extractionSystem,
  extractionUser,
  markSeen,
  parseExtraction,
  planExtraction,
  queueForReview,
  seenCount,
  unseenUserText,
  worthExtracting,
} from "../lib/entity-extraction";
import { lookUpNewEntities, lookupDeps, newLookupTargets } from "../lib/entity-lookup";
import { canInfer, inference } from "../lib/inference";
import { logDebug, logError } from "../lib/log";
import { identity, isEnabled } from "../lib/settings";
import { logTokenUsage } from "../lib/token-usage";
import { parseMessages } from "../lib/transcript";

function sourceId(sessionId: string, count: number): string {
  return `chat ${new Date().toISOString().slice(0, 10)} ${sessionId.slice(0, 8)} #${count}`;
}

/** @lintignore exercised directly by test/entity-extraction.test.ts */
export async function extractSessionEntities(
  transcript: string,
  sessionId?: string
): Promise<void> {
  if (!sessionId || !isEnabled("entityExtraction")) return;
  const seen = seenCount(sessionId);
  const { text, count } = unseenUserText(parseMessages(transcript), seen);
  if (count <= seen) return;

  const index = loadNameIndex(loadKnownEntities());
  const excluded = excludedNames();
  markSeen(sessionId, count);
  if (!worthExtracting(text, index, excluded) || !canInfer()) return;

  const id = identity();
  const result = await inference({
    system: extractionSystem(id.principal.name, id.ai.name),
    user: extractionUser(text, index),
    tier: "medium",
    maxTokens: 900,
    timeout: 90000,
    jsonSchema: extractionSchema(),
    caller: "entity-extraction",
    sessionId,
  });
  if (result.usage) logTokenUsage("entity-extraction", result.usage);
  if (!result.success || !result.output) return;

  const source = sourceId(sessionId, count);
  const plan = planExtraction(parseExtraction(result.output), index, excluded, source);
  const written = ingestEntities(plan.ingest, source);
  queueForReview(plan.review);
  logDebug(
    "entity-extraction",
    `${written.people.length} people, ${written.companies.length} companies, ${plan.review.length} for review`
  );
  if (isEnabled("entityLookup"))
    await lookUpNewEntities(
      newLookupTargets(plan.ingest, written),
      lookupDeps(id.principal.name, inference)
    );
}

if (process.argv[2] === "--run") {
  const sid = process.argv[3];
  const transcriptPath = process.argv[4];
  if (transcriptPath) {
    const { readFile, unlink } = await import("node:fs/promises");
    try {
      const transcript = await readFile(transcriptPath, "utf-8");
      await extractSessionEntities(transcript, sid === "" ? undefined : sid);
    } catch (err) {
      logError("entity-extraction:run", err);
    } finally {
      await unlink(transcriptPath).catch(() => {});
    }
  }
  process.exit(0);
}

/**
 * Hook: userPromptTransformed (Copilot CLI) — appends the context the prompt
 * hook parked to the prompt the model receives.
 */

import { isPalSpawnedInference } from "../core/spawn-guard";
import { recordHookRunOnExit } from "./lib/hook-run";
import {
  type TransformedPromptPayload,
  transformedPromptResponse,
} from "./lib/parked-context";
import { readStdinJSON } from "./lib/stdin";

recordHookRunOnExit();

if (isPalSpawnedInference()) process.exit(0);

const response = transformedPromptResponse(
  await readStdinJSON<TransformedPromptPayload>()
);
if (response) process.stdout.write(response);

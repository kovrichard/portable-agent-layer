/**
 * Hook: userPromptTransformed (Copilot CLI) — appends the context the prompt
 * hook parked to the prompt the model receives.
 */

import {
  type TransformedPromptPayload,
  transformedPromptResponse,
} from "./lib/parked-context";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";

if (isPalSpawnedInference()) process.exit(0);

const response = transformedPromptResponse(
  await readStdinJSON<TransformedPromptPayload>()
);
if (response) process.stdout.write(response);

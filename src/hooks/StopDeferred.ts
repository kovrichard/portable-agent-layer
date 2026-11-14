/**
 * Detached child of a stop hook that returned before the agent wrote its reply
 * to the transcript. argv: the deferred payload's path.
 */

import { isPalSpawnedInference } from "../core/spawn-guard";
import { recordHookRunOnExit } from "./lib/hook-run";
import { finishDeferredStop } from "./lib/stop";

recordHookRunOnExit();

if (isPalSpawnedInference()) process.exit(0);

await finishDeferredStop(process.argv[2] ?? "");

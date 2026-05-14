import type { FlintRule } from "../core/types";
import { noFloatingPromise } from "./no-floating-promise";
import { noMisusedPromises } from "./no-misused-promises";
import { noSyncInAsync } from "./no-sync-in-async";
import { noUnguardedJsonParse } from "./no-unguarded-json-parse";

export const BUILT_IN_RULES: Record<string, FlintRule> = {
  "no-unguarded-json-parse": noUnguardedJsonParse,
  "no-sync-in-async": noSyncInAsync,
  "no-floating-promise": noFloatingPromise,
  "no-misused-promises": noMisusedPromises,
};

import type { FlintRule } from "../core/types";
import { noAsyncPredicate } from "./no-async-predicate";
import { noFloatingPromise } from "./no-floating-promise";
import { noMisusedPromises } from "./no-misused-promises";
import { noSyncInAsync } from "./no-sync-in-async";
import { noThrowString } from "./no-throw-string";
import { noUnguardedJsonParse } from "./no-unguarded-json-parse";

export const BUILT_IN_RULES: Record<string, FlintRule> = {
  "no-unguarded-json-parse": noUnguardedJsonParse,
  "no-sync-in-async": noSyncInAsync,
  "no-floating-promise": noFloatingPromise,
  "no-misused-promises": noMisusedPromises,
  "no-throw-string": noThrowString,
  "no-async-predicate": noAsyncPredicate,
};

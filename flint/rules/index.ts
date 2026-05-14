import type { FlintRule } from "../core/types";
import { noAsyncPredicate } from "./no-async-predicate";
import { noDateEquality } from "./no-date-equality";
import { noFloatingPromise } from "./no-floating-promise";
import { noMisusedPromises } from "./no-misused-promises";
import { noObjectInTemplate } from "./no-object-in-template";
import { noOptionalChainOnNonNullable } from "./no-optional-chain-on-non-nullable";
import { noSyncInAsync } from "./no-sync-in-async";
import { noThrowString } from "./no-throw-string";
import { noUnguardedJsonParse } from "./no-unguarded-json-parse";
import { preferOptionalChain } from "./prefer-optional-chain";

export const BUILT_IN_RULES: Record<string, FlintRule> = {
  "no-unguarded-json-parse": noUnguardedJsonParse,
  "no-sync-in-async": noSyncInAsync,
  "no-floating-promise": noFloatingPromise,
  "no-misused-promises": noMisusedPromises,
  "no-throw-string": noThrowString,
  "no-async-predicate": noAsyncPredicate,
  "no-date-equality": noDateEquality,
  "no-optional-chain-on-non-nullable": noOptionalChainOnNonNullable,
  "no-object-in-template": noObjectInTemplate,
  "prefer-optional-chain": preferOptionalChain,
};

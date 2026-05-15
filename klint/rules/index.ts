import type { KlintRule } from "../core/types";
import { noAsyncPredicate } from "./no-async-predicate";
import { noConsecutiveArrayPush } from "./no-consecutive-array-push";
import { noDateEquality } from "./no-date-equality";
import { noFloatingPromise } from "./no-floating-promise";
import { noMisusedPromises } from "./no-misused-promises";
import { noNestedTemplateLiterals } from "./no-nested-template-literals";
import { noObjectInTemplate } from "./no-object-in-template";
import { noOptionalChainOnNonNullable } from "./no-optional-chain-on-non-nullable";
import { noStringMatch } from "./no-string-match";
import { noSyncInAsync } from "./no-sync-in-async";
import { noUnguardedJsonParse } from "./no-unguarded-json-parse";

export const BUILT_IN_RULES: Record<string, KlintRule> = {
  "no-unguarded-json-parse": noUnguardedJsonParse,
  "no-sync-in-async": noSyncInAsync,
  "no-floating-promise": noFloatingPromise,
  "no-misused-promises": noMisusedPromises,
  "no-async-predicate": noAsyncPredicate,
  "no-date-equality": noDateEquality,
  "no-optional-chain-on-non-nullable": noOptionalChainOnNonNullable,
  "no-object-in-template": noObjectInTemplate,
  "no-nested-template-literals": noNestedTemplateLiterals,
  "no-consecutive-array-push": noConsecutiveArrayPush,
  "no-string-match": noStringMatch,
};

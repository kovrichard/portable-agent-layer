import type { FlintRule } from "../core/types";
import { noSyncInAsync } from "./no-sync-in-async";
import { noUnguardedJsonParse } from "./no-unguarded-json-parse";

export const BUILT_IN_RULES: Record<string, FlintRule> = {
  "no-unguarded-json-parse": noUnguardedJsonParse,
  "no-sync-in-async": noSyncInAsync,
};

import { existsSync, rmSync } from "node:fs";
import {
  legacyRuleLines,
  legacyRulesPath,
  moveLegacyRulesIntoLog,
} from "../../opinions/rule-log";
import type { Migration, MigrationResult } from "./migration";

export const v19RulesToLog: Migration = {
  id: "v19-rules-to-log",
  description:
    "Move the adaptation rules out of rules.json into records/rules/rules.jsonl",

  check() {
    const pending = existsSync(legacyRulesPath());

    return {
      pending,
      detail: pending ? `${legacyRuleLines().length} rule(s) in rules.json` : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    if (!existsSync(legacyRulesPath())) return { migrated: 0, skipped: 0, results: [] };
    const rules = legacyRuleLines().length;

    if (dryRun)
      return {
        migrated: 1,
        skipped: 0,
        results: [`would move ${rules} rule(s) to the log`],
      };
    const added = moveLegacyRulesIntoLog();
    rmSync(legacyRulesPath());

    return {
      migrated: 1,
      skipped: 0,
      results: [`moved ${rules} rule(s) to the log (${added} new line(s))`],
    };
  },
};

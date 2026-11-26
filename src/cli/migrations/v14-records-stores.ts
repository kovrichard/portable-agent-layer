import { storeMoveMigration } from "./store-move";

export const v14RecordsStores = storeMoveMigration(
  "v14-records-stores",
  "Move the recorded stores from memory/ to records/<store>",
  [
    "ledger",
    "ratings",
    "claim-checks",
    "labelled-turns",
    "rule-events",
    "rule-candidates",
    "run-estimates",
    "reflections",
    "sessions-archive",
    "review-queue",
    "import-log",
  ]
);

import { storeMoveMigration } from "./store-move";

export const v16BronzeToRecords = storeMoveMigration(
  "v16-bronze-to-records",
  "Move the bronze event log, its text and tool output to records/bronze/",
  ["events", "event-text", "tool-output"]
);

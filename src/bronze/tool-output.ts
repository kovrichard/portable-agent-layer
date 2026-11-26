import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { storeDir } from "./bronze";

export interface ToolOutputRow {
  id: string;
  ts: string;
  tool: string;
  output: unknown;
  withheld?: true;
}

export function appendToolOutput(row: ToolOutputRow): void {
  appendFileSync(
    resolve(storeDir("tool-output"), `${row.ts.slice(0, 7)}.jsonl`),
    `${JSON.stringify(row)}\n`
  );
}

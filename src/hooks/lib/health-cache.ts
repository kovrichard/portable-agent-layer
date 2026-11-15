import { renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "../../core/paths";

export interface HealthSummary {
  checkedAt: string;
  failing: number;
  warnings: number;
  worst: string | null;
}

export function healthFile(): string {
  return resolve(paths.cache(), "health.json");
}

export function writeHealthSummary(summary: HealthSummary): void {
  const file = healthFile();
  const partial = `${file}.${process.pid}.tmp`;
  writeFileSync(partial, `${JSON.stringify(summary)}\n`, "utf-8");
  renameSync(partial, file);
}

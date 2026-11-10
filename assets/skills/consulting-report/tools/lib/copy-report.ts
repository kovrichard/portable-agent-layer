import { cp } from "node:fs/promises";
import { relative, sep } from "node:path";

const BUILD_OUTPUT = new Set(["node_modules", ".next", "out"]);

function isReportSource(source: string): (path: string) => boolean {
  return (path) => !BUILD_OUTPUT.has(relative(source, path).split(sep)[0]);
}

/** Copies a report project without the dependencies and build output a local run left in it. */
export async function copyReportSource(source: string, target: string): Promise<void> {
  await cp(source, target, { recursive: true, filter: isReportSource(source) });
}

import { cp } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BUILD_OUTPUT = new Set(["node_modules", ".next", "out"]);

function skillFolder(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));

  return resolve(here, "..", "..", name);
}

export function templateDir(): string {
  return skillFolder("template");
}

export function demoDir(): string {
  return skillFolder("demo");
}

function isReportSource(source: string): (path: string) => boolean {
  return (path) => !BUILD_OUTPUT.has(relative(source, path).split(sep)[0]);
}

/** Copies a report project without the dependencies and build output a local run left in it. */
export async function copyReportSource(source: string, target: string): Promise<void> {
  await cp(source, target, { recursive: true, filter: isReportSource(source) });
}

export async function copyTemplateWithOverlay(
  template: string,
  overlay: string,
  target: string
): Promise<void> {
  await copyReportSource(template, target);
  await copyReportSource(overlay, target);
}

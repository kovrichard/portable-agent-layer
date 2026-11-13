import { type ProjectProgress, readProject } from "../../hooks/lib/projects";
import { UsageError } from "../lib/command";

export function now(): string {
  return new Date().toISOString();
}

export function fail(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

export function ok(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload, null, 2));
}

export function requireProject(name: string): ProjectProgress {
  const p = readProject(name);
  if (!p) fail(`No project named "${name}". Run 'list' to see registered projects.`);

  return p as ProjectProgress;
}

export function positiveId(value: string, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw new UsageError(`${label} must be a positive integer, got "${value}"`);
  }

  return id;
}

export function nonBlank(text: string, slot: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new UsageError(`${slot} is empty`);

  return trimmed;
}

export function joined(words: string[]): string {
  return words.join(" ");
}

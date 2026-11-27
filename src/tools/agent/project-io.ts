import { type ProjectProgress, readProject } from "../../progress/projects";
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

/** An ISC id as typed: `k7m2`, `ISC-k7m2`, `#k7m2` or an old number like `151`. */
export function iscIdArg(value: string | undefined, label: string): string {
  const id = (value ?? "")
    .trim()
    .replace(/^(ISC-|#)/i, "")
    .toLowerCase();
  if (!/^[0-9a-z]+$/.test(id) || /^0+$/.test(id))
    throw new UsageError(`${label} must be an ISC id like k7m2 or 151, got "${value}"`);

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

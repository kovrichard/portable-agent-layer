import { existsSync, lstatSync, readdirSync, readlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function describeUnresolvedSkills(dir: string, names: string[]): string {
  return [...names.map((name) => describeEntry(dir, name)), describeFolder(dir)].join(
    "\n"
  );
}

function describeEntry(dir: string, name: string): string {
  const entry = resolve(dir, name);
  if (!entryExists(entry)) return `${name}: does not exist`;
  if (!lstatSync(entry).isSymbolicLink()) return `${name}: exists, not a symlink`;
  const target = linkTarget(entry);
  const targetState = existsSync(target) ? "exists" : "does not exist";
  return `${name}: symlink to ${target}, target ${targetState}`;
}

function entryExists(entry: string): boolean {
  try {
    lstatSync(entry);
    return true;
  } catch {
    return false;
  }
}

function linkTarget(link: string): string {
  return resolve(dirname(link), readlinkSync(link));
}

function describeFolder(dir: string): string {
  if (!existsSync(dir)) return `${dir} does not exist`;
  const entries = readdirSync(dir).sort();
  if (entries.length === 0) return `${dir} holds nothing`;
  return `${dir} holds: ${entries.join(", ")}`;
}

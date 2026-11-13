import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { jsonText } from "./json-file";

const KEPT_BACKUPS = 5;

function backupsOf(path: string): string[] {
  const prefix = `${basename(path)}.bak.`;
  const stampOf = (name: string) => Number(name.slice(prefix.length));

  return readdirSync(dirname(path))
    .filter((name) => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)))
    .sort((a, b) => stampOf(b) - stampOf(a))
    .map((name) => resolve(dirname(path), name));
}

function pruneBackups(path: string): void {
  for (const old of backupsOf(path).slice(KEPT_BACKUPS)) unlinkSync(old);
}

/** Writes a config only when its content changes, backing up what it replaces. */
export function replaceConfig(path: string, content: string): void {
  const current = existsSync(path) ? readFileSync(path, "utf-8") : null;
  if (current !== content) {
    if (current !== null) copyFileSync(path, `${path}.bak.${Date.now()}`);
    writeFileSync(path, content, "utf-8");
  }

  pruneBackups(path);
}

export function replaceJsonConfig(path: string, data: unknown): void {
  replaceConfig(path, jsonText(data));
}

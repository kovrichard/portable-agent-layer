import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function linesMentioning(dir: string, type: string): Record<string, unknown>[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .flatMap((file) => readFileSync(resolve(dir, file), "utf-8").split("\n"))
    .filter((line) => line.includes(`"type":"${type}"`))
    .map((line) => JSON.parse(line));
}

export function memoryMoveEvents(home: string): Record<string, unknown>[] {
  return linesMentioning(resolve(home, "memory", "events"), "memory_move");
}

export function memoryMoveDetails(home: string): Record<string, unknown>[] {
  return linesMentioning(resolve(home, "memory", "content", "events"), "memory_move");
}

export function manifestsIn(home: string): string[] {
  const dir = resolve(home, "backups");

  return existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith(".manifest.jsonl"))
    : [];
}

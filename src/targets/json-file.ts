import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function readJson<T = Record<string, unknown>>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export const jsonText = (data: unknown) => `${JSON.stringify(data, null, 2)}\n`;

export function writeJson(path: string, data: unknown): void {
  writeFileSync(path, jsonText(data), "utf-8");
}

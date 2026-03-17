import { resolve, dirname } from "path";
import { existsSync, mkdirSync } from "fs";

/** Root of the PAI installation */
export function paiDir(): string {
  return process.env.PAI_DIR || resolve(dirname(import.meta.dir), "..");
}

/** Resolve a path relative to PAI root */
export function paiPath(...segments: string[]): string {
  return resolve(paiDir(), ...segments);
}

/** Ensure a directory exists, creating it recursively if needed */
export function ensureDir(path: string): string {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
  return path;
}

// Common paths
export const paths = {
  telos: () => paiPath("telos"),
  memory: () => paiPath("memory"),
  learning: () => ensureDir(paiPath("memory", "learning")),
  signals: () => ensureDir(paiPath("memory", "signals")),
  state: () => ensureDir(paiPath("memory", "state")),
  research: () => ensureDir(paiPath("memory", "research")),
  skills: () => paiPath("skills"),
  hooks: () => paiPath("hooks"),
} as const;

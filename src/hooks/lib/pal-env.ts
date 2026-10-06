/**
 * Credentials PAL reads from ~/.pal/.env. A variable already set in the
 * environment wins; the file fills the gaps. Agents launched from a desktop
 * app never read a shell profile, so hooks they spawn see only this file.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { palHome } from "./paths";

type Env = Record<string, string | undefined>;

export function palEnvPath(): string {
  return resolve(palHome(), ".env");
}

function withoutExportPrefix(line: string): string {
  return line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
}

function unquoted(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

export function parsePalEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = withoutExportPrefix(raw.trim());
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    values[line.slice(0, eq).trim()] = unquoted(line.slice(eq + 1).trim());
  }
  return values;
}

function readPalEnvFile(): Record<string, string> {
  try {
    return parsePalEnv(readFileSync(palEnvPath(), "utf-8"));
  } catch {
    return {};
  }
}

export function withPalEnv(env: Env = process.env): Env {
  const merged: Env = { ...env };
  for (const [key, value] of Object.entries(readPalEnvFile())) {
    if (!merged[key]) merged[key] = value;
  }
  return merged;
}

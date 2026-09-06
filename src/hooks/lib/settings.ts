/**
 * PalSettings — single source of truth for pal-settings.json.
 *
 * Reads once, caches in memory for the process lifetime.
 * All consumers import from here instead of reading the file directly.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

// ── Types ──

interface Identity {
  ai: { name: string; fullName: string; displayName: string; catchphrase: string };
  principal: { name: string; timezone: string };
}

export interface PalSettingsData {
  identity?: {
    ai?: { name?: string; fullName?: string; displayName?: string; catchphrase?: string };
    principal?: { name?: string; timezone?: string };
  };
  loadAtStartup?: { files?: string[] };
  dynamicContext?: Record<string, boolean>;
  /** Git co-author attribution opt-in. `decided` gates the one-time prompt. */
  attribution?: { enabled?: boolean; decided?: boolean };
  /**
   * Action-ledger user extension. `redactPaths` adds to the built-in set of
   * paths whose contents are never stored; it cannot shrink it.
   */
  ledger?: { redactPaths?: string[] };
  /** Control-room ranking knobs and attention sources — see src/tools/control-room/prefs.ts. */
  controlRoom?: Record<string, unknown>;
  /** Contextual-steering user extension: personal rules + shipped rules to suppress by tag. */
  steering?: {
    disable?: string[];
    rules?: Array<{ tag: string; pattern: string; snippet: string }>;
  };
  [key: string]: unknown;
}

const IDENTITY_DEFAULTS: Identity = {
  ai: {
    name: "Assistant",
    fullName: "AI Assistant",
    displayName: "ASSISTANT",
    catchphrase: "",
  },
  principal: { name: "User", timezone: "" },
};

// ── Singleton ──

let cached: PalSettingsData | null = null;

function settingsPath(): string {
  return resolve(paths.memory(), "pal-settings.json");
}

function load(): PalSettingsData {
  if (cached) return cached;
  const p = settingsPath();
  if (!existsSync(p)) {
    cached = {};
    return cached;
  }
  try {
    cached = JSON.parse(readFileSync(p, "utf-8")) as PalSettingsData;
    return cached;
  } catch {
    cached = {};
    return cached;
  }
}

/** Force re-read from disk (useful after writes) */
export function reload(): PalSettingsData {
  cached = null;
  return load();
}

// ── Public API ──

/** Get the raw settings data */
export function raw(): PalSettingsData {
  return load();
}

/** Get resolved identity with defaults */
export function identity(): Identity {
  const data = load();
  const ai = data.identity?.ai ?? {};
  const principal = data.identity?.principal ?? {};
  const name = ai.name || IDENTITY_DEFAULTS.ai.name;
  const catchphrase = (ai.catchphrase || "").replace("{name}", name);

  return {
    ai: {
      name,
      fullName: ai.fullName || IDENTITY_DEFAULTS.ai.fullName,
      displayName: ai.displayName || IDENTITY_DEFAULTS.ai.displayName,
      catchphrase,
    },
    principal: {
      name: principal.name || IDENTITY_DEFAULTS.principal.name,
      timezone: principal.timezone || IDENTITY_DEFAULTS.principal.timezone,
    },
  };
}

/** Check if a dynamic context section is enabled (defaults to true) */
export function isEnabled(key: string): boolean {
  return load().dynamicContext?.[key] !== false;
}

/** Get the loadAtStartup file list */
export function startupFiles(): string[] {
  return load().loadAtStartup?.files ?? [];
}

/** Write settings back to disk and bust cache */
export function write(data: PalSettingsData): void {
  writeFileSync(settingsPath(), `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  cached = null;
}

import { readFileSync } from "node:fs";
import { canonicalPalCmd, isOutdatedPalHook } from "../pal-hook-command";

type CursorHookEntry = {
  type: string;
  command: string;
  matcher?: string;
  timeout?: number;
};
type CursorHooks = {
  version?: number;
  hooks?: Record<string, CursorHookEntry[]>;
};

/**
 * Load a Cursor hooks template, replacing {{PKG_ROOT}} with the actual path.
 */
export function loadCursorHooksTemplate(
  templatePath: string,
  pkgRoot: string
): CursorHooks {
  const raw = readFileSync(templatePath, "utf-8");
  const resolved = raw.replaceAll("{{PKG_ROOT}}", pkgRoot);
  try {
    return JSON.parse(resolved) as CursorHooks;
  } catch (e) {
    throw new Error(`Failed to parse Cursor hooks template at ${templatePath}: ${e}`);
  }
}

/**
 * Merge PAL hooks into an existing Cursor hooks.json.
 * Deduplicates by command string within each event.
 */
export function mergeCursorHooks(
  existing: CursorHooks,
  template: CursorHooks
): CursorHooks {
  const result: CursorHooks = { ...existing, version: existing.version ?? 1 };

  if (template.hooks) {
    result.hooks ??= {};
    const palCanonical = canonicalTemplateCommands(template.hooks);
    stripOutdatedPalHooks(result.hooks, palCanonical);
    appendTemplateHooks(result.hooks, template.hooks);
  }

  return result;
}

type CursorHookMap = NonNullable<CursorHooks["hooks"]>;

function canonicalTemplateCommands(templateHooks: CursorHookMap): Set<string> {
  const palCanonical = new Set<string>();
  for (const entries of Object.values(templateHooks)) {
    for (const entry of entries) palCanonical.add(canonicalPalCmd(entry.command));
  }
  return palCanonical;
}

function stripOutdatedPalHooks(hooks: CursorHookMap, palCanonical: Set<string>): void {
  for (const [event, entries] of Object.entries(hooks)) {
    hooks[event] = entries.filter((e) => !isOutdatedPalHook(e.command, palCanonical));
    if (hooks[event].length === 0) delete hooks[event];
  }
}

function appendTemplateHooks(hooks: CursorHookMap, templateHooks: CursorHookMap): void {
  for (const [event, entries] of Object.entries(templateHooks)) {
    const current = hooks[event] ?? [];
    for (const entry of entries) current.push(entry);
    hooks[event] = current;
  }
}

/**
 * Remove PAL hooks from an existing Cursor hooks.json.
 * Only removes entries whose command matches the template. Preserves user hooks.
 */
export function unmergeCursorHooks(
  existing: CursorHooks,
  template: CursorHooks
): CursorHooks {
  const result: CursorHooks = { ...existing };

  if (template.hooks && result.hooks) {
    const palCommands = new Set<string>();
    for (const entries of Object.values(template.hooks)) {
      for (const entry of entries) {
        palCommands.add(entry.command);
      }
    }

    for (const [event, entries] of Object.entries(result.hooks)) {
      result.hooks[event] = entries.filter((e) => !palCommands.has(e.command));
      if (result.hooks[event].length === 0) delete result.hooks[event];
    }
    if (Object.keys(result.hooks).length === 0) delete result.hooks;
  }

  return result;
}

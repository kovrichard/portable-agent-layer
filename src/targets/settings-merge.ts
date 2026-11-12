import { readFileSync } from "node:fs";
import { canonicalPalCmd, isOutdatedPalHook } from "./pal-hook-command";

type HookEntry = { matcher?: string; hooks?: Array<{ type: string; command: string }> };
export type Settings = Record<string, unknown> & {
  hooks?: Record<string, HookEntry[]>;
  permissions?: { allow?: string[]; deny?: string[]; ask?: string[] };
};

/**
 * Load a settings template, replacing {{PKG_ROOT}} with the actual package root.
 */
export function loadSettingsTemplate(templatePath: string, pkgRoot: string): Settings {
  const raw = readFileSync(templatePath, "utf-8");
  const resolved = raw.replaceAll("{{PKG_ROOT}}", pkgRoot);
  try {
    return JSON.parse(resolved) as Settings;
  } catch (e) {
    throw new Error(`Failed to parse settings template at ${templatePath}: ${e}`);
  }
}

/**
 * Merge a PAL settings template into existing settings.
 * - hooks: deduplicate by command string
 * - permissions.allow: deduplicate by value
 * - other keys: template values are added if not already present
 */
/** Set by the template on first install; after that the user's value wins. */
const USER_OWNED_SETTINGS = [
  "attribution",
  "showClearContextOnPlanAccept",
  "respectGitignore",
  "spinnerTipsEnabled",
  "autoMemoryEnabled",
] as const;

/** Entries PAL owns by key: its marketplace follows the install path, the user's choices win. */
const PAL_KEYED_SETTINGS = {
  extraKnownMarketplaces: "pal-wins",
  enabledPlugins: "user-wins",
  env: "user-wins",
} as const;

type KeyedEntries = Record<string, unknown>;

function mergeKeyedSettings(result: Settings, template: Settings): void {
  for (const [key, owner] of Object.entries(PAL_KEYED_SETTINGS)) {
    const palEntries = template[key] as KeyedEntries | undefined;
    if (!palEntries) continue;
    const entries = { ...((result[key] as KeyedEntries | undefined) ?? {}) };
    for (const [name, value] of Object.entries(palEntries)) {
      if (owner === "pal-wins" || !(name in entries)) entries[name] = value;
    }
    result[key] = entries;
  }
}

function unmergeKeyedSettings(result: Settings, template: Settings): void {
  for (const key of Object.keys(PAL_KEYED_SETTINGS)) {
    const palEntries = template[key] as KeyedEntries | undefined;
    const entries = result[key] as KeyedEntries | undefined;
    if (!palEntries || !entries) continue;
    const kept = Object.fromEntries(
      Object.entries(entries).filter(([name]) => !(name in palEntries))
    );
    if (Object.keys(kept).length === 0) delete result[key];
    else result[key] = kept;
  }
}

export function mergeSettings(existing: Settings, template: Settings): Settings {
  const result = { ...existing };
  mergeKeyedSettings(result, template);
  mergeHooks(result, template);
  mergePermissions(result, template);
  mergeSkillOverrides(result, template);
  for (const key of USER_OWNED_SETTINGS) {
    if (key in template && !(key in result)) result[key] = template[key];
  }
  mergeSpinnerTips(result, template);
  return result;
}

function palHookCommands(templateHooks: Record<string, HookEntry[]>): Set<string> {
  const palCanonical = new Set<string>();
  for (const entries of Object.values(templateHooks)) {
    for (const entry of entries) {
      const cmd = entry.hooks?.[0]?.command;
      if (cmd) palCanonical.add(canonicalPalCmd(cmd));
    }
  }
  return palCanonical;
}

function removeHooksWhere(
  hooks: Record<string, HookEntry[]>,
  isPal: (cmd: string) => boolean
): void {
  for (const [event, entries] of Object.entries(hooks)) {
    hooks[event] = entries.filter((e) => {
      const cmd = e.hooks?.[0]?.command;
      return !cmd || !isPal(cmd);
    });
    if (hooks[event].length === 0) delete hooks[event];
  }
}

/** Strips old-path PAL entries first, so reinstalling from a different path (repo vs global) leaves no orphans that fire twice. */
function mergeHooks(result: Settings, template: Settings): void {
  if (!template.hooks) return;
  result.hooks ??= {};
  const palCanonical = palHookCommands(template.hooks);
  removeHooksWhere(result.hooks, (cmd) => isOutdatedPalHook(cmd, palCanonical));
  for (const [event, entries] of Object.entries(template.hooks)) {
    const current = result.hooks[event] ?? [];
    for (const entry of entries) current.push(entry);
    result.hooks[event] = current;
  }
}

function mergePermissions(result: Settings, template: Settings): void {
  if (!template.permissions?.allow) return;
  result.permissions ??= {};
  result.permissions.allow ??= [];
  for (const perm of template.permissions.allow) {
    if (!result.permissions.allow.includes(perm)) result.permissions.allow.push(perm);
  }
}

function mergeSkillOverrides(result: Settings, template: Settings): void {
  if (!template.skillOverrides || typeof template.skillOverrides !== "object") return;
  result.skillOverrides ??= {};
  const resultOverrides = result.skillOverrides as Record<string, unknown>;
  for (const [skill, value] of Object.entries(template.skillOverrides)) {
    if (!(skill in resultOverrides)) resultOverrides[skill] = value;
  }
}

function hasTipsArray(
  value: unknown
): value is Record<string, unknown> & { tips: string[] } {
  return (
    !!value &&
    typeof value === "object" &&
    "tips" in value &&
    Array.isArray((value as Record<string, unknown>).tips)
  );
}

function mergeSpinnerTips(result: Settings, template: Settings): void {
  if (!hasTipsArray(template.spinnerTipsOverride)) return;
  result.spinnerTipsOverride ??= { tips: [] };
  const resultOverride = result.spinnerTipsOverride as Record<string, unknown>;
  resultOverride.tips ??= [];
  const tips = resultOverride.tips as string[];
  for (const tip of template.spinnerTipsOverride.tips) {
    if (typeof tip === "string" && !tips.includes(tip)) tips.push(tip);
  }
}

/**
 * Remove everything a PAL settings template added from existing settings.
 * - hooks: remove entries whose command matches any template command
 * - permissions.allow: remove entries that appear in the template
 * - cleans up empty arrays/objects
 */
export function unmergeSettings(existing: Settings, template: Settings): Settings {
  const result = { ...existing };
  unmergeKeyedSettings(result, template);
  unmergeHooks(result, template);
  unmergePermissions(result, template);
  unmergeSkillOverrides(result, template);
  for (const key of USER_OWNED_SETTINGS) {
    if (key in template) delete result[key];
  }
  unmergeSpinnerTips(result, template);
  return result;
}

function unmergeHooks(result: Settings, template: Settings): void {
  if (!template.hooks || !result.hooks) return;
  const palCanonical = palHookCommands(template.hooks);
  removeHooksWhere(result.hooks, (cmd) => palCanonical.has(canonicalPalCmd(cmd)));
  if (Object.keys(result.hooks).length === 0) delete result.hooks;
}

function unmergePermissions(result: Settings, template: Settings): void {
  if (!template.permissions?.allow || !result.permissions?.allow) return;
  const palPerms = new Set(template.permissions.allow);
  result.permissions.allow = result.permissions.allow.filter((p) => !palPerms.has(p));
  if (result.permissions.allow.length === 0) delete result.permissions.allow;
  if (Object.keys(result.permissions).length === 0) delete result.permissions;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function unmergeSkillOverrides(result: Settings, template: Settings): void {
  if (!isObject(template.skillOverrides) || !isObject(result.skillOverrides)) return;
  for (const skill of Object.keys(template.skillOverrides)) {
    delete result.skillOverrides[skill];
  }
  if (Object.keys(result.skillOverrides).length === 0) delete result.skillOverrides;
}

function unmergeSpinnerTips(result: Settings, template: Settings): void {
  const templateOverride = template.spinnerTipsOverride;
  const resultOverride = result.spinnerTipsOverride;
  if (!hasTipsArray(templateOverride) || !hasTipsArray(resultOverride)) return;
  const templateTips = new Set(templateOverride.tips);
  resultOverride.tips = resultOverride.tips.filter((tip) => !templateTips.has(tip));
  if (resultOverride.tips.length === 0 && Object.keys(resultOverride).length === 1) {
    delete result.spinnerTipsOverride;
  }
}

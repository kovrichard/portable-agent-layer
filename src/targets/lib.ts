/**
 * Shared utilities for PAL installers.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { assets, palHome, platform } from "../hooks/lib/paths";
import { declaredTriggers } from "../hooks/lib/skill-triggers";

// --- Colored logging ---

function runningUnderTest(): boolean {
  return process.env.PAL_TEST_SANDBOX === "1";
}

export const log = {
  info: (msg: string) => console.log(`\x1b[34m[pal]\x1b[0m ${msg}`),
  success: (msg: string) => console.log(`\x1b[32m[pal]\x1b[0m ${msg}`),
  warn: (msg: string) => console.log(`\x1b[33m[pal]\x1b[0m ${msg}`),
  error: (msg: string) => console.error(`\x1b[31m[pal]\x1b[0m ${msg}`),

  /**
   * Per-item narration from inside a loop, where the caller already reports the
   * total. Silent under the test runner: the suite drives these installers by
   * the hundred against temp directories, so the lines name files that were
   * never on this machine — and they are the only output no caller asserts on,
   * precisely because the summary is what carries the result.
   */
  detail: (msg: string) => {
    if (runningUnderTest()) return;
    console.log(`\x1b[34m[pal]\x1b[0m ${msg}`);
  },
};

// --- JSON helpers ---

export function readJson<T = Record<string, unknown>>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

// --- Git attribution ---

/** Public PAL repository — the link surfaced in commit/PR co-author credits. */
export const PAL_REPO_URL = "https://github.com/kovrichard/portable-agent-layer";

/**
 * Build the commit footer (bare URL, autolinks on GitHub) and PR body line
 * (markdown link). `sessionUrl` is off because Claude Code otherwise appends a
 * claude.ai session link to commits made from web or Remote Control sessions,
 * which puts a link to a private transcript in a public history.
 */
export function buildAttributionText(
  name: string,
  repoUrl: string = PAL_REPO_URL
): { commit: string; pr: string; sessionUrl: false } {
  return {
    commit: `Co-authored by ${name} · ${repoUrl}`,
    pr: `Co-authored by [${name}](${repoUrl})`,
    sessionUrl: false,
  };
}

/**
 * Apply the user's git-attribution choice to a Claude settings object.
 * Enabled → fill attribution.commit/pr and drop Claude's own byline (includeCoAuthoredBy:false).
 * Disabled → clear PAL attribution and restore Claude's default byline.
 */
export function applyAttribution(
  settings: Settings,
  opts: { enabled: boolean; name: string; repoUrl?: string }
): Settings {
  const result = { ...settings };
  if (opts.enabled) {
    result.attribution = buildAttributionText(opts.name, opts.repoUrl);
    result.includeCoAuthoredBy = false;
  } else {
    result.attribution = { commit: "", pr: "", sessionUrl: false };
    if (result.includeCoAuthoredBy === false) delete result.includeCoAuthoredBy;
  }
  return result;
}

/** Resolve the VS Code user settings.json path cross-platform. Returns null on unknown platforms. */
export function vscodeSettingsFile(): string | null {
  const h = homedir();
  if (process.platform === "darwin") {
    return resolve(h, "Library", "Application Support", "Code", "User", "settings.json");
  }
  if (process.platform === "linux") {
    return resolve(
      process.env.XDG_CONFIG_HOME ?? resolve(h, ".config"),
      "Code",
      "User",
      "settings.json"
    );
  }
  if (process.platform === "win32") {
    return resolve(
      process.env.APPDATA ?? resolve(h, "AppData", "Roaming"),
      "Code",
      "User",
      "settings.json"
    );
  }
  return null;
}

// --- Settings template merge/unmerge ---

type HookEntry = { matcher?: string; hooks?: Array<{ type: string; command: string }> };
type Settings = Record<string, unknown> & {
  hooks?: Record<string, HookEntry[]>;
  permissions?: { allow?: string[]; deny?: string[]; ask?: string[] };
};

/**
 * Load a settings template, replacing {{PKG_ROOT}} with the actual path.
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
export function mergeSettings(existing: Settings, template: Settings): Settings {
  const result = { ...existing };

  // Merge hooks — strip old-path PAL entries first, then insert current template entries.
  // This handles reinstalling from a different path (repo vs global install) without
  // leaving orphan hook entries that fire twice per event.
  if (template.hooks) {
    result.hooks ??= {};

    // Collect canonical forms of all template hook commands
    const palCanonical = new Set<string>();
    for (const entries of Object.values(template.hooks)) {
      for (const entry of entries) {
        const cmd = entry.hooks?.[0]?.command;
        if (cmd) palCanonical.add(canonicalPalCmd(cmd));
      }
    }

    // Strip existing PAL hooks that match canonically (removes old-path duplicates)
    for (const [event, entries] of Object.entries(result.hooks)) {
      result.hooks[event] = entries.filter((e) => {
        const cmd = e.hooks?.[0]?.command;
        return !cmd || !palCanonical.has(canonicalPalCmd(cmd));
      });
      if (result.hooks[event].length === 0) delete result.hooks[event];
    }

    // Insert template entries (old-path versions were just stripped)
    for (const [event, entries] of Object.entries(template.hooks)) {
      const current = result.hooks[event] ?? [];
      for (const entry of entries) current.push(entry);
      result.hooks[event] = current;
    }
  }

  // Merge permissions.allow (deduplicate), then drop deprecated entries.
  if (template.permissions?.allow) {
    result.permissions ??= {};
    result.permissions.allow ??= [];
    for (const perm of template.permissions.allow) {
      if (!result.permissions.allow.includes(perm)) {
        result.permissions.allow.push(perm);
      }
    }
  }
  // Strip ineffective Grep(...)/Glob(...) rules left by older templates. Claude Code
  // governs Grep/Glob via Read(...) rules, so a path-scoped Grep()/Glob() entry never
  // matches and Claude Code warns about it on every prompt. Read(//*) already covers them.
  if (result.permissions?.allow) {
    result.permissions.allow = result.permissions.allow.filter(
      (perm) => !isIneffectiveFileToolRule(perm)
    );
  }

  // Merge skillOverrides (object with skill name keys, add if not present)
  if (template.skillOverrides && typeof template.skillOverrides === "object") {
    result.skillOverrides ??= {};
    const resultOverrides = result.skillOverrides as Record<string, unknown>;
    for (const [skill, value] of Object.entries(template.skillOverrides)) {
      if (!(skill in resultOverrides)) {
        resultOverrides[skill] = value;
      }
    }
  }

  // Merge attribution (object with commit/pr keys, add if not present)
  if (template.attribution && typeof template.attribution === "object") {
    if (!("attribution" in result)) {
      result.attribution = template.attribution;
    }
  }

  // Merge showClearContextOnPlanAccept (boolean, add if not present)
  if ("showClearContextOnPlanAccept" in template) {
    if (!("showClearContextOnPlanAccept" in result)) {
      result.showClearContextOnPlanAccept = template.showClearContextOnPlanAccept;
    }
  }

  // Merge respectGitignore (boolean, add if not present)
  if ("respectGitignore" in template) {
    if (!("respectGitignore" in result)) {
      result.respectGitignore = template.respectGitignore;
    }
  }

  // Merge spinnerTipsEnabled (boolean, add if not present)
  if ("spinnerTipsEnabled" in template) {
    if (!("spinnerTipsEnabled" in result)) {
      result.spinnerTipsEnabled = template.spinnerTipsEnabled;
    }
  }

  // Merge spinnerTipsOverride (merge tips array, deduplicate by content)
  if (
    template.spinnerTipsOverride &&
    typeof template.spinnerTipsOverride === "object" &&
    "tips" in template.spinnerTipsOverride &&
    Array.isArray((template.spinnerTipsOverride as Record<string, unknown>).tips)
  ) {
    result.spinnerTipsOverride ??= { tips: [] };
    const resultOverride = result.spinnerTipsOverride as Record<string, unknown>;
    resultOverride.tips ??= [];
    const tips = resultOverride.tips as string[];
    const templateTips = (template.spinnerTipsOverride as Record<string, unknown>)
      .tips as string[];
    for (const tip of templateTips) {
      if (typeof tip === "string" && !tips.includes(tip)) {
        tips.push(tip);
      }
    }
  }

  return result;
}

/**
 * Remove everything a PAL settings template added from existing settings.
 * - hooks: remove entries whose command matches any template command
 * - permissions.allow: remove entries that appear in the template
 * - cleans up empty arrays/objects
 */
export function unmergeSettings(existing: Settings, template: Settings): Settings {
  const result = { ...existing };

  // Collect canonical PAL hook commands from template (path-normalized)
  if (template.hooks && result.hooks) {
    const palCanonical = new Set<string>();
    for (const entries of Object.values(template.hooks)) {
      for (const entry of entries) {
        const cmd = entry.hooks?.[0]?.command;
        if (cmd) palCanonical.add(canonicalPalCmd(cmd));
      }
    }

    for (const [event, entries] of Object.entries(result.hooks)) {
      result.hooks[event] = entries.filter((e) => {
        const cmd = e.hooks?.[0]?.command;
        return !cmd || !palCanonical.has(canonicalPalCmd(cmd));
      });
      if (result.hooks[event].length === 0) delete result.hooks[event];
    }
    if (Object.keys(result.hooks).length === 0) delete result.hooks;
  }

  // Remove PAL permissions
  if (template.permissions?.allow && result.permissions?.allow) {
    const palPerms = new Set(template.permissions.allow);
    result.permissions.allow = result.permissions.allow.filter((p) => !palPerms.has(p));
    if (result.permissions.allow.length === 0) delete result.permissions.allow;
    if (Object.keys(result.permissions).length === 0) delete result.permissions;
  }

  // Remove PAL skillOverrides (remove keys that appear in template)
  if (
    template.skillOverrides &&
    typeof template.skillOverrides === "object" &&
    result.skillOverrides &&
    typeof result.skillOverrides === "object"
  ) {
    const palSkills = new Set(Object.keys(template.skillOverrides));
    for (const skill of palSkills) {
      delete (result.skillOverrides as Record<string, unknown>)[skill];
    }
    if (Object.keys(result.skillOverrides).length === 0) delete result.skillOverrides;
  }

  // Remove PAL attribution if it matches template structure
  if (template.attribution && "attribution" in result) {
    delete result.attribution;
  }

  // Remove PAL showClearContextOnPlanAccept
  if (
    "showClearContextOnPlanAccept" in template &&
    "showClearContextOnPlanAccept" in result
  ) {
    delete result.showClearContextOnPlanAccept;
  }

  // Remove PAL respectGitignore
  if ("respectGitignore" in template && "respectGitignore" in result) {
    delete result.respectGitignore;
  }

  // Remove PAL spinnerTipsEnabled
  if ("spinnerTipsEnabled" in template && "spinnerTipsEnabled" in result) {
    delete result.spinnerTipsEnabled;
  }

  // Remove PAL spinnerTipsOverride (remove only template tips, preserve user tips)
  if (
    template.spinnerTipsOverride &&
    typeof template.spinnerTipsOverride === "object" &&
    "tips" in template.spinnerTipsOverride &&
    Array.isArray((template.spinnerTipsOverride as Record<string, unknown>).tips) &&
    result.spinnerTipsOverride &&
    typeof result.spinnerTipsOverride === "object" &&
    "tips" in result.spinnerTipsOverride &&
    Array.isArray((result.spinnerTipsOverride as Record<string, unknown>).tips)
  ) {
    const templateTipsArray = (template.spinnerTipsOverride as Record<string, unknown>)
      .tips as string[];
    const templateTips = new Set(templateTipsArray);
    const resultOverride = result.spinnerTipsOverride as Record<string, unknown>;
    const tips = resultOverride.tips as string[];
    resultOverride.tips = tips.filter((tip) => !templateTips.has(tip));
    if (
      (resultOverride.tips as string[]).length === 0 &&
      Object.keys(resultOverride).length === 1
    ) {
      delete result.spinnerTipsOverride;
    }
  }

  return result;
}

// --- Cursor hooks.json merge/unmerge ---

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

    // Collect canonical forms of all template hook commands
    const palCanonical = new Set<string>();
    for (const entries of Object.values(template.hooks)) {
      for (const entry of entries) palCanonical.add(canonicalPalCmd(entry.command));
    }

    // Strip existing PAL hooks that match canonically (removes old-path duplicates)
    for (const [event, entries] of Object.entries(result.hooks)) {
      result.hooks[event] = entries.filter(
        (e) => !palCanonical.has(canonicalPalCmd(e.command))
      );
      if (result.hooks[event].length === 0) delete result.hooks[event];
    }

    // Insert template entries (old-path versions were just stripped)
    for (const [event, entries] of Object.entries(template.hooks)) {
      const current = result.hooks[event] ?? [];
      for (const entry of entries) current.push(entry);
      result.hooks[event] = current;
    }
  }

  return result;
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

// --- Codex hooks (nested group format, distinct from Cursor's flat format) ---

type CodexHookCommand = { type: string; command: string; timeout?: number };
type CodexHookGroup = { matcher?: string; hooks: CodexHookCommand[] };
type CodexHooks = {
  hooks?: Record<string, CodexHookGroup[]>;
  description?: string;
  version?: unknown;
};

/**
 * Codex parses hooks.json strictly and accepts only `description` and `hooks`.
 * A stale `version` makes it reject the whole file — every PAL hook silently
 * stops — and merging preserves what it finds, so it must be dropped by name.
 */
function withoutRejectedFields(config: CodexHooks): CodexHooks {
  const { version: _version, ...accepted } = config;
  return accepted;
}

/**
 * Normalize a PAL hook command for cross-path deduplication.
 * Strips env-var prefix and normalizes the hook file path so reinstalling from
 * a different location (repo vs global install) correctly strips old entries.
 * "PAL_AGENT=x bun run /any/path/src/hooks/Foo.ts" → "bun run src/hooks/Foo.ts"
 */
function canonicalPalCmd(cmd: string): string {
  const withoutEnv = cmd.replace(/^(?:\w+=\S+\s+)+/, "");
  const hookMatch = /bun\s+run\s+.+\/src\/hooks\/(\S+)/.exec(withoutEnv);
  if (hookMatch) return `bun run src/hooks/${hookMatch[1]}`;
  return withoutEnv;
}

/**
 * True for path-scoped Grep()/Glob() allow rules, which Claude Code cannot honor —
 * it resolves Grep/Glob permission through Read(...) rules, so these never match and
 * trigger a warning on every prompt. Bare "Grep"/"Glob" tool allows are left intact.
 */
function isIneffectiveFileToolRule(perm: string): boolean {
  return /^(?:Grep|Glob)\(/.test(perm);
}

export function loadCodexHooksTemplate(
  templatePath: string,
  pkgRoot: string
): CodexHooks {
  const raw = readFileSync(templatePath, "utf-8");
  const resolved = raw.replaceAll("{{PKG_ROOT}}", pkgRoot);
  try {
    return JSON.parse(resolved) as CodexHooks;
  } catch (e) {
    throw new Error(`Failed to parse Codex hooks template at ${templatePath}: ${e}`);
  }
}

/** Collect canonical command paths from a Codex hooks template (PAL-managed commands). */
function collectPalCanonical(template: CodexHooks): Set<string> {
  return new Set(
    Object.values(template.hooks ?? {}).flatMap((groups) =>
      groups.flatMap((g) => g.hooks.map((h) => canonicalPalCmd(h.command)))
    )
  );
}

/** Strip entries (nested or flat) whose canonical command matches a PAL-managed command. */
function stripPalHooks(
  hooks: Record<string, CodexHookGroup[]>,
  palCanonical: Set<string>
): void {
  for (const event of Object.keys(hooks)) {
    hooks[event] = (hooks[event] ?? [])
      .map((g) => {
        const flat = g as unknown as CodexHookCommand;
        if (!g.hooks && flat.command && palCanonical.has(canonicalPalCmd(flat.command))) {
          return null;
        }
        const filtered = (g.hooks ?? []).filter(
          (h) => !palCanonical.has(canonicalPalCmd(h.command))
        );
        return filtered.length > 0 ? { ...g, hooks: filtered } : null;
      })
      .filter((g): g is CodexHookGroup => g !== null);
    if (hooks[event].length === 0) delete hooks[event];
  }
}

/** Merge PAL hooks into an existing Codex hooks.json. Deduplicates by canonical command path. */
export function mergeCodexHooks(existing: CodexHooks, template: CodexHooks): CodexHooks {
  const result: CodexHooks = withoutRejectedFields(existing);
  if (!template.hooks) return result;
  result.hooks ??= {};

  stripPalHooks(result.hooks, collectPalCanonical(template));

  for (const [event, groups] of Object.entries(template.hooks)) {
    const current = result.hooks[event] ?? [];
    for (const group of groups) current.push(group);
    result.hooks[event] = current;
  }
  return result;
}

/** Remove PAL hooks from an existing Codex hooks.json. Preserves user hooks. */
export function unmergeCodexHooks(
  existing: CodexHooks,
  template: CodexHooks
): CodexHooks {
  const result: CodexHooks = withoutRejectedFields(existing);
  if (!template.hooks || !result.hooks) return result;

  stripPalHooks(result.hooks, collectPalCanonical(template));
  if (Object.keys(result.hooks).length === 0) delete result.hooks;
  return result;
}

// --- Codex rules (Starlark .rules file) ---

const CODEX_RULES_BEGIN = "# BEGIN PAL MANAGED CODEX RULES";
const CODEX_RULES_END = "# END PAL MANAGED CODEX RULES";

export function loadCodexRulesTemplate(templatePath: string): string {
  return readFileSync(templatePath, "utf-8").trim();
}

function stripPalCodexRules(content: string): string {
  const escapedBegin = CODEX_RULES_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = CODEX_RULES_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = new RegExp(String.raw`\n?${escapedBegin}[\s\S]*?${escapedEnd}\n?`, "g");
  return content
    .replace(block, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function mergeCodexRules(existing: string, template: string): string {
  const preserved = stripPalCodexRules(existing);
  const prefix = preserved ? `${preserved}\n\n` : "";
  return `${prefix}${template.trim()}\n`;
}

export function unmergeCodexRules(existing: string): string {
  const cleaned = stripPalCodexRules(existing);
  return cleaned ? `${cleaned}\n` : "";
}

// --- Codex TUI status line ---

const PAL_CODEX_STATUS_LINE = [
  "model-with-reasoning",
  "context-remaining",
  "context-used",
  "five-hour-limit",
  "weekly-limit",
  "git-branch",
  "used-tokens",
  "thread-id",
  "current-dir",
  "codex-version",
] as const;

function codexStatusLineToml(): string {
  const quotedItems = PAL_CODEX_STATUS_LINE.map((item) => JSON.stringify(item)).join(
    ", "
  );
  return `tui.status_line = [${quotedItems}]\ntui.status_line_use_colors = true\n`;
}

function hasCodexStatusLine(content: string): boolean {
  return /^[ \t]*(?:tui\.)?status_line[ \t]*=/m.test(content);
}

/** Add Codex TUI status-line defaults unless the user already configured one. */
export function addCodexStatuslineConfig(content: string): string {
  if (hasCodexStatusLine(content)) return content;

  const block = codexStatusLineToml();
  if (content.trim() === "") return block;

  const firstTable = content.search(/^[ \t]*\[/m);
  if (firstTable === -1) {
    return `${content}${content.endsWith("\n") ? "" : "\n"}${block}`;
  }

  const before = content.slice(0, firstTable);
  const after = content.slice(firstTable);
  return `${before}${before.endsWith("\n") || before === "" ? "" : "\n"}${block}\n${after}`;
}

/** Remove PAL's default Codex status-line config if it still matches exactly. */
export function removeCodexStatuslineConfig(content: string): string {
  const lines = content.split("\n");
  const statusLine = codexStatusLineToml().trim().split("\n")[0];
  const colors = codexStatusLineToml().trim().split("\n")[1];
  const filtered: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    const next = lines[i + 1]?.trim();
    if (line === statusLine && next === colors) {
      i++;
      continue;
    }
    filtered.push(lines[i] ?? "");
  }

  return filtered.join("\n").replace(/\n{3,}/g, "\n\n");
}

// --- TELOS scaffolding ---

/** Copy template files into telos/ without overwriting existing ones */
export function scaffoldTelos(): void {
  const templatesDir = assets.telosTemplates();
  const telosDir = resolve(palHome(), "telos");
  if (!existsSync(templatesDir)) return;
  mkdirSync(telosDir, { recursive: true });

  for (const file of readdirSync(templatesDir).filter((f) => f.endsWith(".md"))) {
    const src = resolve(templatesDir, file);
    const dst = resolve(telosDir, file);
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
      log.info(`Created ${file} from template`);
    }
  }
}

// --- PAL settings scaffolding ---

/** Copy pal-settings.json template to memory/ without overwriting */
export function scaffoldPalSettings(): void {
  const src = resolve(assets.skills(), "..", "templates", "pal-settings.json");
  if (!existsSync(src)) return;

  const memDir = resolve(palHome(), "memory");
  mkdirSync(memDir, { recursive: true });

  const dst = resolve(memDir, "pal-settings.json");
  if (!existsSync(dst)) {
    copyFileSync(src, dst);
    log.info("Created pal-settings.json from template");
  }

  // Strip deprecated loadAtStartup.files entries from existing installs.
  // mergeSettings only adds, never removes — deprecated entries persist indefinitely otherwise.
  try {
    const raw = JSON.parse(readFileSync(dst, "utf-8"));
    const files: string[] = raw?.loadAtStartup?.files ?? [];
    const cleaned = files.filter((f: string) => !f.endsWith("PROJECTS.md"));
    if (cleaned.length !== files.length) {
      raw.loadAtStartup.files = cleaned;
      writeFileSync(dst, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
      log.info("Removed deprecated PROJECTS.md from loadAtStartup.files");
    }
  } catch {
    /* non-fatal — malformed settings left as-is */
  }
}

// --- PAL docs (modular context routing files) ---

const palDocsDir = () => resolve(palHome(), "docs");
const palToolsDir = () => resolve(palHome(), "tools");

/**
 * Install PAL system docs into ~/.pal/docs/.
 * Always overwrites — these are engine-managed, not user-editable.
 * Also creates ~/.pal/tools/ → repo agent tools (symlink).
 */
export function copyPalDocs(): number {
  const srcDir = assets.palDocs();
  if (!existsSync(srcDir)) return 0;

  mkdirSync(palDocsDir(), { recursive: true });
  let count = 0;

  for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".md"))) {
    const src = resolve(srcDir, file);
    const dst = resolve(palDocsDir(), file);
    copyFileSync(src, dst);
    count++;
  }

  // ~/.pal/tools/ → repo agent tools
  const linkType = process.platform === "win32" ? "junction" : "dir";
  ensureSymlink(palToolsDir(), assets.agentTools(), linkType);

  return count;
}

/** Remove PAL system docs from ~/.pal/docs/ */
export function removePalDocs(): void {
  // Remove tools symlink
  try {
    unlinkSync(palToolsDir());
  } catch {
    /* gone */
  }
  if (!existsSync(palDocsDir())) return;
  try {
    rmSync(palDocsDir(), { recursive: true });
    log.info("Removed ~/.pal/docs/");
  } catch {
    /* gone */
  }
}

// --- Skills ---

const palSkillsDir = () => resolve(palHome(), "skills");

/**
 * Run one step of a bulk install, naming it only when it fails.
 *
 * Installs handle dozens of skills and agents; a line each buries the paths,
 * backups and warnings that a reader actually has to act on. Returning false
 * instead of throwing also keeps one unlinkable skill from aborting the rest.
 */
function reportOnlyOnFailure(label: string, install: () => void): boolean {
  try {
    install();
    return true;
  } catch (e) {
    log.warn(`Could not install ${label} — ${(e as Error).message}`);
    return false;
  }
}

/**
 * Install PAL skills by symlinking:
 *   ~/.pal/skills/<name> → <repo>/assets/skills/<name>  (source of truth)
 *   ~/.claude/skills/<name> → ~/.pal/skills/<name>       (agent discovery)
 *
 * Symlinks mean tools inside skills can import from the repo (src/hooks/lib/*)
 * and everything resolves naturally. Additive — skips skills already installed.
 */
export function copySkills(claudeSkillsDir: string): number {
  const skillsDir = assets.skills();
  if (!existsSync(skillsDir)) return 0;

  mkdirSync(palSkillsDir(), { recursive: true });
  mkdirSync(claudeSkillsDir, { recursive: true });
  const linkType = process.platform === "win32" ? "junction" : "dir";
  let count = 0;

  for (const name of pruneStaleSkillLinks(claudeSkillsDir)) {
    log.detail(`Removed stale skill link: ${name}`);
  }

  for (const name of readdirSync(skillsDir)) {
    const srcDir = resolve(skillsDir, name);
    if (!existsSync(resolve(srcDir, "SKILL.md"))) continue;

    const palLink = resolve(palSkillsDir(), name);
    const claudeLink = resolve(claudeSkillsDir, name);
    const linked = reportOnlyOnFailure(`skill ${name}`, () => {
      // ~/.pal/skills/<name> → <repo>/assets/skills/<name>
      ensureSymlink(palLink, srcDir, linkType);
      // ~/.claude/skills/<name> → ~/.pal/skills/<name>
      ensureSymlink(claudeLink, palLink, linkType);
    });
    if (linked) count++;
  }

  // ~/.agents/skills/ → ~/.pal/skills/
  mkdirSync(platform.agentsDir(), { recursive: true });
  ensureSymlink(resolve(platform.agentsDir(), "skills"), palSkillsDir(), linkType);

  return count;
}

/** True when `link` is a symlink whose target no longer exists. */
function isDanglingSymlink(link: string): boolean {
  try {
    return lstatSync(link).isSymbolicLink() && !existsSync(link);
  } catch {
    return false;
  }
}

/** True when the symlink at `link` points at `root` or somewhere beneath it. */
function symlinkPointsInto(link: string, root: string): boolean {
  try {
    const target = resolve(dirname(link), readlinkSync(link));
    return target === root || target.startsWith(root + sep);
  } catch {
    return false;
  }
}

/**
 * Remove discovery links left behind when a shipped skill is renamed or
 * retired. Ownership is read from where a link points, not from metadata:
 * a dead link has no SKILL.md to read, but its target path still says
 * whether PAL created it.
 *
 *   ~/.pal/skills/<name>   → pruned when dangling and pointing into assets/skills/
 *   <agent>/skills/<name>  → pruned when dangling and pointing into ~/.pal/skills/
 *
 * Personal skills are real directories, so they are never candidates, and a
 * user's own symlinks to anywhere else are left alone even when broken.
 */
function pruneStaleSkillLinks(agentSkillsDir: string): string[] {
  const ownedTrees = [
    { dir: palSkillsDir(), root: assets.skills() },
    { dir: agentSkillsDir, root: palSkillsDir() },
  ];
  const removed: string[] = [];
  for (const { dir, root } of ownedTrees) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const link = resolve(dir, name);
      if (!isDanglingSymlink(link) || !symlinkPointsInto(link, root)) continue;
      unlinkSync(link);
      removed.push(name);
    }
  }
  return removed;
}

/**
 * Agent skills directories that need a per-skill discovery link.
 *
 * opencode is intentionally absent: it discovers the whole ~/.pal/skills/ tree
 * via the ~/.agents/skills → ~/.pal/skills symlink, so any personal skill is
 * picked up without a per-skill link.
 */
function perSkillAgentDirs(): { agent: string; dir: string }[] {
  return [
    { agent: "claude", dir: resolve(platform.claudeDir(), "skills") },
    { agent: "cursor", dir: resolve(platform.cursorDir(), "skills") },
    { agent: "copilot", dir: resolve(platform.copilotDir(), "skills") },
    { agent: "codex", dir: resolve(platform.codexDir(), "skills") },
  ];
}

/**
 * Link a personal skill that already lives at ~/.pal/skills/<name>/ into every
 * installed agent's skills directory so the agent discovers it. Mirrors the
 * per-skill discovery link copySkills() creates for shipped skills.
 *
 * An agent counts as installed when its skills directory already exists.
 * Returns the agents a discovery link was created for (opencode excluded — it
 * is covered by the whole-dir ~/.agents/skills link).
 */
export function linkPersonalSkill(name: string): string[] {
  const palLink = resolve(palSkillsDir(), name);
  if (!existsSync(resolve(palLink, "SKILL.md"))) {
    throw new Error(`No skill found at ${palLink}/SKILL.md`);
  }
  const linkType = process.platform === "win32" ? "junction" : "dir";
  const linked: string[] = [];
  for (const { agent, dir } of perSkillAgentDirs()) {
    if (!existsSync(dir)) continue; // agent not installed
    ensureSymlink(resolve(dir, name), palLink, linkType);
    linked.push(agent);
  }
  return linked;
}

/**
 * The agent config trees PAL writes into when no env override is set. These are
 * the developer's own installed agents, so a test that forgets to point the
 * PAL_*_DIR vars at a sandbox silently rewires their real setup.
 */
function realAgentRoots(): string[] {
  const h = homedir();
  return [
    resolve(h, ".pal"),
    resolve(h, ".claude"),
    resolve(h, ".cursor"),
    resolve(h, ".copilot"),
    resolve(h, ".codex"),
    resolve(h, ".agents"),
    resolve(h, ".config", "opencode"),
  ];
}

/**
 * Under `bun test` (PAL_TEST_SANDBOX, set by the test preload and inherited by
 * spawned CLIs), refuse any link that would land in a real agent tree. Tests
 * sandbox PAL_HOME far more reliably than they sandbox the per-agent dirs, and
 * the failure is otherwise invisible: the suite passes while the developer's
 * own agents accumulate links into a deleted test directory.
 */
function assertInsideTestSandbox(link: string): void {
  if (!process.env.PAL_TEST_SANDBOX) return;
  const escaped = realAgentRoots().find(
    (root) => link === root || link.startsWith(root + sep)
  );
  if (!escaped) return;
  throw new Error(
    `Refusing to write ${link}: outside the test sandbox (${escaped} is a real agent directory). ` +
      "Point PAL_CLAUDE_DIR, PAL_CURSOR_DIR, PAL_COPILOT_DIR, PAL_CODEX_DIR, " +
      "PAL_OPENCODE_DIR and PAL_AGENTS_DIR at a temp directory in this test."
  );
}

/** Create or update a symlink/junction, replacing any non-symlink entry. */
function ensureSymlink(link: string, target: string, type: "dir" | "junction"): void {
  assertInsideTestSandbox(link);
  try {
    const st = lstatSync(link);
    if (st.isSymbolicLink()) return; // already a symlink, leave it
    rmSync(link, { recursive: true, force: true });
  } catch {
    // doesn't exist or broken — clean up just in case
    try {
      rmSync(link, { recursive: true, force: true });
    } catch {
      /* gone */
    }
  }
  symlinkSync(target, link, type);
}

/**
 * Remove every `pal-*` context file with the given suffix from a directory.
 *
 * Globs rather than iterating getSemiStaticSources(): a slug retired from that
 * registry keeps its already-written file on disk, and a registry-driven delete
 * can no longer name it — agents then keep loading retired context forever.
 * Also catches the legacy pre-split filenames without needing a special case.
 */
export function removePalContextFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  const removed: string[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.startsWith("pal-") || !file.endsWith(suffix)) continue;
    try {
      unlinkSync(resolve(dir, file));
      removed.push(file);
    } catch {
      /* gone or not ours to remove */
    }
  }
  return removed;
}

/** Remove PAL skill symlinks from ~/.pal/skills/ and ~/.claude/skills/ */
export function removeSkills(claudeSkillsDir: string): string[] {
  const skillsDir = assets.skills();
  if (!existsSync(skillsDir)) return [];

  const removed: string[] = [];
  for (const name of readdirSync(skillsDir)) {
    if (!existsSync(resolve(skillsDir, name, "SKILL.md"))) continue;

    for (const link of [resolve(palSkillsDir(), name), resolve(claudeSkillsDir, name)]) {
      try {
        unlinkSync(link);
      } catch {
        /* already gone */
      }
    }
    removed.push(name);
    log.detail(`Removed skill: ${name}`);
  }

  // Remove ~/.agents/skills/ → ~/.pal/skills/ symlink
  try {
    unlinkSync(resolve(platform.agentsDir(), "skills"));
  } catch {
    /* gone */
  }

  return removed;
}

// --- Agents ---

const claudeAgentsDir = () => resolve(platform.claudeDir(), "agents");

/**
 * Install PAL agent definitions into ~/.claude/agents/.
 * Always overwrites — engine-managed, not user-editable.
 */
export function copyAgents(): number {
  return installAgents(claudeAgentsDir(), "claude");
}

/** Remove PAL agents from ~/.claude/agents/ */
export function removeAgents(): string[] {
  const agentsDir = assets.agents();
  if (!existsSync(agentsDir)) return [];

  const removed: string[] = [];
  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const dst = resolve(claudeAgentsDir(), file);
    if (existsSync(dst)) {
      unlinkSync(dst);
      const name = file.replace(/\.md$/, "");
      removed.push(name);
      log.detail(`Removed agent: ${name}`);
    }
  }
  return removed;
}

/** Count agent .md files in ~/.claude/agents/ */
export function countAgents(): number {
  if (!existsSync(claudeAgentsDir())) return 0;
  try {
    return readdirSync(claudeAgentsDir()).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

// --- Agent platform extraction ---

const AGENT_PLATFORMS = ["claude", "opencode", "cursor", "copilot"] as const;
type AgentPlatform = (typeof AGENT_PLATFORMS)[number];

/**
 * Extract a platform-specific agent file from the unified agent format.
 *
 * Each agent .md defines platform blocks at the top level:
 *   claude:     → fields for Claude Code
 *   opencode:   → fields for opencode
 *   cursor:     → fields for Cursor
 *
 * Global fields (name, description) are always included.
 * The target platform block is un-indented and merged into the root.
 * All other platform blocks are stripped.
 */
function extractAgentForPlatform(content: string, platform: AgentPlatform): string {
  const parts = content.split(/^---\s*$/m);
  if (parts.length < 3) return content;

  const frontmatter = parts[1];
  const body = parts.slice(2).join("---");

  const globalLines: string[] = [];
  const platformLines: Record<AgentPlatform, string[]> = {
    claude: [],
    opencode: [],
    cursor: [],
    copilot: [],
  };
  let currentPlatform: AgentPlatform | null = null;

  for (const line of frontmatter.split("\n")) {
    if (!line.trim()) continue;

    const platformMatch = new RegExp(/^(claude|opencode|cursor|copilot):\s*$/).exec(line);
    if (platformMatch) {
      currentPlatform = platformMatch[1] as AgentPlatform;
      continue;
    }

    if (currentPlatform) {
      if (new RegExp(/^ {2}/).exec(line)) {
        platformLines[currentPlatform].push(line.slice(2)); // un-indent one level
        continue;
      }
      currentPlatform = null; // end of platform block
    }

    globalLines.push(line);
  }

  const newFrontmatter = [...globalLines, ...platformLines[platform]]
    .filter((l) => l.trim())
    .join("\n");

  return `---\n${newFrontmatter}\n---\n${body}`;
}

/** Install agents for a platform into a target directory. Always overwrites. */
function installAgents(targetDir: string, platform: AgentPlatform): number {
  const agentsDir = assets.agents();
  if (!existsSync(agentsDir)) return 0;

  mkdirSync(targetDir, { recursive: true });
  let count = 0;

  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const name = file.replace(/\.md$/, "");
    const installed = reportOnlyOnFailure(`${platform} agent ${name}`, () => {
      const content = readFileSync(resolve(agentsDir, file), "utf-8");
      writeFileSync(
        resolve(targetDir, file),
        extractAgentForPlatform(content, platform),
        "utf-8"
      );
    });
    if (installed) count++;
  }
  return count;
}

/** Remove PAL agents from a directory. */
function uninstallAgents(targetDir: string, label: string): string[] {
  const agentsDir = assets.agents();
  if (!existsSync(agentsDir)) return [];

  const removed: string[] = [];
  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const dst = resolve(targetDir, file);
    if (existsSync(dst)) {
      unlinkSync(dst);
      removed.push(file.replace(/\.md$/, ""));
      log.detail(`Removed ${label} agent: ${file.replace(/\.md$/, "")}`);
    }
  }
  return removed;
}

export function copyAgentsForOpencode(ocAgentsDir: string): number {
  return installAgents(ocAgentsDir, "opencode");
}

export function removeAgentsFromOpencode(ocAgentsDir: string): string[] {
  return uninstallAgents(ocAgentsDir, "opencode");
}

export function copyAgentsForCursor(cursorAgentsDir: string): number {
  return installAgents(cursorAgentsDir, "cursor");
}

export function copyAgentsForCopilot(copilotAgentsDir: string): number {
  return installAgents(copilotAgentsDir, "copilot");
}

export function removeAgentsFromCursor(cursorAgentsDir: string): string[] {
  return uninstallAgents(cursorAgentsDir, "cursor");
}

export function removeAgentsFromCopilot(copilotAgentsDir: string): string[] {
  return uninstallAgents(copilotAgentsDir, "copilot");
}

// --- Personal subagents (user-authored, under ~/.pal/agents/) ---

/**
 * Store for user-authored subagents: ~/.pal/agents/<name>.md — one merged
 * multi-platform frontmatter file per subagent (same schema as assets/agents/).
 */
const palAgentsStore = () => resolve(palHome(), "agents");

/**
 * Each installed agent and the native agents directory a personal subagent is
 * written into. An agent counts as installed when its agents directory already
 * exists (mirrors linkPersonalSkill's per-agent gate).
 */
function personalSubagentTargets(): { agent: AgentPlatform; dir: string }[] {
  return [
    { agent: "claude", dir: resolve(platform.claudeDir(), "agents") },
    { agent: "opencode", dir: resolve(platform.opencodeDir(), "agents") },
    { agent: "cursor", dir: resolve(platform.cursorDir(), "agents") },
    { agent: "copilot", dir: resolve(platform.copilotDir(), "agents") },
  ];
}

/** Names of the subagents PAL ships (assets/agents/*.md). */
function shippedAgentNames(): Set<string> {
  const dir = assets.agents();
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
  );
}

/** List the user-authored subagents in ~/.pal/agents/. */
export function listPersonalSubagents(): string[] {
  if (!existsSync(palAgentsStore())) return [];
  return readdirSync(palAgentsStore())
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

/**
 * Install a personal subagent (~/.pal/agents/<name>.md) into every installed
 * agent by splitting its merged frontmatter per platform and writing the
 * result into that agent's native agents dir. Unlike personal skills (which are
 * symlinked), subagents are transformed-and-copied because each platform needs
 * its own frontmatter shape. Returns the agents it was installed into.
 */
export function installPersonalSubagent(name: string): string[] {
  const src = resolve(palAgentsStore(), `${name}.md`);
  if (!existsSync(src)) {
    throw new Error(`No subagent found at ${src}`);
  }
  if (shippedAgentNames().has(name)) {
    throw new Error(
      `'${name}' is a shipped PAL subagent — choose another name (a reinstall would overwrite it).`
    );
  }
  const content = readFileSync(src, "utf-8");
  const installed: string[] = [];
  for (const { agent, dir } of personalSubagentTargets()) {
    if (!existsSync(dir)) continue; // agent not installed
    writeFileSync(
      resolve(dir, `${name}.md`),
      extractAgentForPlatform(content, agent),
      "utf-8"
    );
    installed.push(agent);
  }
  return installed;
}

/** Load and resolve the Copilot hooks template, substituting PKG_ROOT */
export function loadCopilotHooksTemplate(templatePath: string, pkgRoot: string): unknown {
  const resolved = readFileSync(templatePath, "utf-8").replaceAll(
    "{{PKG_ROOT}}",
    pkgRoot
  );
  try {
    return JSON.parse(resolved);
  } catch (e) {
    throw new Error(`Failed to parse Copilot hooks template at ${templatePath}: ${e}`);
  }
}

// --- Statusline ---

export type StatuslineTarget = "claude" | "cursor";

function statuslineAgentDir(target: StatuslineTarget): string {
  return target === "claude" ? platform.claudeDir() : platform.cursorDir();
}

function statuslineCommand(target: StatuslineTarget): string {
  const isPlatformWin32 = process.platform === "win32";
  if (target === "cursor") {
    return isPlatformWin32
      ? "powershell -NoProfile -File ~/.cursor/statusline.ps1"
      : "~/.cursor/statusline.sh";
  }
  return isPlatformWin32
    ? "powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/statusline.ps1"
    : "~/.claude/statusline.sh";
}

function isPalStatuslineCommand(cmd: string, target: StatuslineTarget): boolean {
  return target === "claude"
    ? cmd.includes(".claude/statusline")
    : cmd.includes(".cursor/statusline");
}

/** Copy statusline script to ~/.claude/ or ~/.cursor/ for the current platform */
export function copyStatusline(target: StatuslineTarget = "claude"): boolean {
  const agentDir = statuslineAgentDir(target);
  mkdirSync(agentDir, { recursive: true });

  const isPlatformWin32 = process.platform === "win32";
  const sourcePath = isPlatformWin32
    ? assets.statuslineScriptPs1()
    : assets.statuslineScriptBash();
  const scriptName = isPlatformWin32 ? "statusline.ps1" : "statusline.sh";
  const destPath = resolve(agentDir, scriptName);

  if (!existsSync(sourcePath)) {
    log.warn(`Statusline script not found at ${sourcePath}`);
    return false;
  }

  try {
    copyFileSync(sourcePath, destPath);

    if (process.platform !== "win32") {
      chmodSync(destPath, 0o755);
    }

    log.success(`Statusline installed to ${destPath}`);
    return true;
  } catch (e) {
    log.warn(`Failed to copy statusline script: ${e}`);
    return false;
  }
}

/** Remove statusline script from ~/.claude/ or ~/.cursor/ */
export function removeStatusline(target: StatuslineTarget = "claude"): boolean {
  const isPlatformWin32 = process.platform === "win32";
  const scriptName = isPlatformWin32 ? "statusline.ps1" : "statusline.sh";
  const scriptPath = resolve(statuslineAgentDir(target), scriptName);

  if (!existsSync(scriptPath)) {
    log.info("Statusline script not found, nothing to remove");
    return true;
  }

  try {
    unlinkSync(scriptPath);
    log.success(`Removed statusline script from ${scriptPath}`);
    return true;
  } catch (e) {
    log.warn(`Failed to remove statusline script: ${e}`);
    return false;
  }
}

function isOldGetContentClaudeCommand(cmd: string): boolean {
  return cmd.includes("Get-Content -Raw");
}

function isPalWindowsClaudeCommandMissingBypass(cmd: string): boolean {
  return (
    process.platform === "win32" &&
    isPalStatuslineCommand(cmd, "claude") &&
    cmd.includes("powershell") &&
    !cmd.includes("-ExecutionPolicy Bypass")
  );
}

function claudeStatuslineNeedsRefresh(cmd: string): boolean {
  return isOldGetContentClaudeCommand(cmd) || isPalWindowsClaudeCommandMissingBypass(cmd);
}

/** Add statusLine config if not already present or if using an old broken command */
export function addStatuslineConfig(
  settings: Record<string, unknown>,
  target: StatuslineTarget = "claude"
): Record<string, unknown> {
  const statusLine = settings.statusLine as Record<string, unknown> | undefined;

  if (statusLine && typeof statusLine === "object" && statusLine.command) {
    const cmd = statusLine.command as string;
    if (target === "claude") {
      if (!claudeStatuslineNeedsRefresh(cmd)) {
        return settings;
      }
    } else if (!isPalStatuslineCommand(cmd, "cursor")) {
      // Cursor: preserve user-defined statusLine commands
      return settings;
    }
  }

  const command = statuslineCommand(target);
  settings.statusLine = {
    type: "command",
    command,
    padding: 2,
    ...(target === "cursor" ? { updateIntervalMs: 300, timeoutMs: 2000 } : {}),
  };

  return settings;
}

/** Remove statusLine config from settings (PAL-owned only for Cursor) */
export function removeStatuslineConfig(
  settings: Record<string, unknown>,
  target: StatuslineTarget = "claude"
): Record<string, unknown> {
  const statusLine = settings.statusLine as Record<string, unknown> | undefined;
  if (!statusLine || typeof statusLine !== "object") {
    return settings;
  }

  if (target === "claude") {
    delete settings.statusLine;
    return settings;
  }

  const cmd = statusLine.command as string | undefined;
  if (cmd && isPalStatuslineCommand(cmd, "cursor")) {
    delete settings.statusLine;
  }
  return settings;
}

// --- Skill Index ---

interface SkillIndexEntry {
  name: string;
  description: string;
  triggers: string[];
}

interface SkillIndex {
  generated: string;
  totalSkills: number;
  skills: Record<string, SkillIndexEntry>;
}

/** Fallback triggers for a skill that declares none: keywords mined from its description. */
function extractTriggers(description: string): string[] {
  // Extract "Use when ..." phrases and key terms
  const triggers = new Set<string>();

  const useWhen = new RegExp(/Use when\s+(.+?)(?:\.|$)/i).exec(description);
  if (useWhen) {
    const words = useWhen[1]
      .toLowerCase()
      .split(/[,\s]+/)
      .filter(
        (w) =>
          w.length > 3 &&
          !["when", "this", "that", "with", "from", "about", "your", "the"].includes(w)
      );
    for (const w of words) triggers.add(w);
  }

  // Extract domain terms from full description
  const terms = description
    .toLowerCase()
    .match(
      /\b(research|analyze|extract|summarize|review|debug|reflect|council|debate|brainstorm|first.principles|security|pdf|youtube|telos|goals|projects|beliefs|challenges|opinion|skill|create)\b/g
    );
  if (terms) for (const t of terms) triggers.add(t);

  return [...triggers];
}

/**
 * Generate skill-index.json from installed skills in ~/.pal/skills/.
 * Called during install after skills are symlinked.
 */
export function generateSkillIndex(): number {
  if (!existsSync(palSkillsDir())) return 0;

  const index: SkillIndex = {
    generated: new Date().toISOString(),
    totalSkills: 0,
    skills: {},
  };

  for (const name of readdirSync(palSkillsDir())) {
    const skillMd = resolve(palSkillsDir(), name, "SKILL.md");
    if (!existsSync(skillMd)) continue;

    try {
      const content = readFileSync(skillMd, "utf-8");
      const fmMatch = new RegExp(/^---\n([\s\S]*?)\n---/).exec(content);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      const nameMatch = new RegExp(/^name:\s*(.+)$/m).exec(fm);
      const descMatch = new RegExp(/^description:\s*"?(.+?)"?\s*$/m).exec(fm);
      if (!nameMatch) continue;

      const skillName = nameMatch[1].trim();
      const description = descMatch?.[1]?.trim() ?? "";

      const declared = declaredTriggers(fm);

      index.skills[skillName] = {
        name: skillName,
        description,
        triggers: declared.length > 0 ? declared : extractTriggers(description),
      };
      index.totalSkills++;
    } catch {
      /* skip unreadable skills */
    }
  }

  // Write to state directory
  const stateDir = resolve(palHome(), "memory", "state");
  mkdirSync(stateDir, { recursive: true });
  writeJson(resolve(stateDir, "skill-index.json"), index);

  return index.totalSkills;
}

/** Count skill subdirectories in ~/.pal/skills/ */
export function countSkills(): number {
  if (!existsSync(palSkillsDir())) return 0;
  try {
    return readdirSync(palSkillsDir()).filter((f) =>
      existsSync(resolve(palSkillsDir(), f, "SKILL.md"))
    ).length;
  } catch {
    return 0;
  }
}

/** Count .md files in a directory */
export function countMd(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

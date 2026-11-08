import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { claudeConfigFile } from "../../tools/lib/collectors/billing";
import { isClaude } from "./agent";
import { appendEvent, logQuietly } from "./events";
import { type HookTurnPayload, hookSessionId } from "./hook-turn";
import { modelLimitsFor } from "./models";
import { platform } from "./paths";
import { contextModelOf, contextTokensOf } from "./session-events";
import { isPalSpawnedInference } from "./spawn-guard";

const MAX_OUTPUT_CAP = 20_000;
const SUMMARY_BUFFER = 13_000;
const IDLE_MIN_DEFAULT = 200_000;
const IDLE_MIN_FLOOR = 100_000;
const WINDOW_ENV = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
const IDLE_MIN_ENV = "CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS";
export const COMPACTION_MARGIN_FRACTION = 0.2;
export const IDLE_COMPACT_AFTER_MS = 0.9 * 60 * 60_000;

interface CompactionPointInput {
  window: number;
  modelContextWindow: number;
  modelMaxOutput: number;
}

interface CompactionWindow {
  tokens: number;
  source: string;
}

interface CompactionWindowSources {
  model: string | null;
  modelContextWindow: number | null;
  env: Record<string, string | undefined>;
  settingsFiles: string[];
  claudeJsonPath: string;
}

interface CompactionHookPayload extends HookTurnPayload {
  transcript_path?: string | null;
  cwd?: string;
}

function usableWindow(input: CompactionPointInput): number {
  return (
    Math.min(input.window, input.modelContextWindow) -
    Math.min(input.modelMaxOutput, MAX_OUTPUT_CAP)
  );
}

export function compactionPoint(input: CompactionPointInput): number {
  return usableWindow(input) - SUMMARY_BUFFER;
}

export function compactionMarginTokens(
  input: CompactionPointInput,
  fraction: number = COMPACTION_MARGIN_FRACTION
): number {
  return Math.round(fraction * usableWindow(input));
}

export function compactionPredicted(tokensLeft: number, marginTokens: number): boolean {
  return tokensLeft <= marginTokens;
}

export function compactionInput(
  model: string | null,
  window: number
): CompactionPointInput {
  const limits = modelLimitsFor(model);
  return {
    window,
    modelContextWindow: limits?.contextWindow ?? window,
    modelMaxOutput: limits?.maxOutput ?? MAX_OUTPUT_CAP,
  };
}

const MANAGED_SETTINGS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "/Library/Application Support/ClaudeCode/managed-settings.json",
  win32: "C:\\Program Files\\ClaudeCode\\managed-settings.json",
};

function claudeSettingsFiles(
  projectDir: string,
  claudeDir: string,
  os: NodeJS.Platform
): string[] {
  return [
    MANAGED_SETTINGS[os] ?? "/etc/claude-code/managed-settings.json",
    resolve(projectDir, ".claude", "settings.local.json"),
    resolve(projectDir, ".claude", "settings.json"),
    resolve(claudeDir, "settings.json"),
  ];
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    return plainObject(JSON.parse(readFileSync(path, "utf-8"))) ?? {};
  } catch {
    return {};
  }
}

function positiveTokens(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function objectField(record: unknown, key: string): Record<string, unknown> | null {
  const owner = plainObject(record);
  if (!owner || !Object.hasOwn(owner, key)) return null;
  return plainObject(owner[key]);
}

function settingsWindow(value: unknown): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

function perModelSettingsWindow(
  settings: Record<string, unknown>,
  model: string | null
): number | null {
  if (typeof model !== "string") return null;
  return settingsWindow(
    objectField(objectField(settings, "modelSettings"), model)?.autoCompactWindow
  );
}

function topLevelSettingsWindow(settings: Record<string, unknown>): number | null {
  return settingsWindow(settings.autoCompactWindow);
}

function settingsEnvWindow(settings: Record<string, unknown>): number | null {
  return positiveTokens(objectField(settings, "env")?.[WINDOW_ENV]);
}

function cachedWindow(model: string | null, claudeJsonPath: string): number | null {
  if (typeof model !== "string") return null;
  const cache = objectField(readJsonObject(claudeJsonPath), "autoCompactWindowsCache");
  return cache && Object.hasOwn(cache, model) ? positiveTokens(cache[model]) : null;
}

function firstWindow(windows: (number | null)[]): number | null {
  return windows.find((tokens) => tokens !== null) ?? null;
}

export function resolveCompactionWindow(
  sources: CompactionWindowSources
): CompactionWindow | null {
  const settings = sources.settingsFiles.map(readJsonObject);
  const candidates: [number | null, string][] = [
    [
      firstWindow(settings.map((s) => perModelSettingsWindow(s, sources.model))),
      "settings",
    ],
    [firstWindow(settings.map(topLevelSettingsWindow)), "settings"],
    [positiveTokens(sources.env[WINDOW_ENV]), "env"],
    [firstWindow(settings.map(settingsEnvWindow)), "settings-env"],
    [cachedWindow(sources.model, sources.claudeJsonPath), "cache"],
  ];
  for (const [tokens, source] of candidates) {
    if (tokens !== null) return { tokens, source };
  }
  return sources.modelContextWindow !== null
    ? { tokens: sources.modelContextWindow, source: "model" }
    : null;
}

export function currentCompactionWindow(
  model: string | null,
  projectDir: string
): CompactionWindow | null {
  return resolveCompactionWindow({
    model,
    modelContextWindow: modelLimitsFor(model)?.contextWindow ?? null,
    env: process.env,
    settingsFiles: claudeSettingsFiles(
      projectDir,
      platform.claudeDir(),
      process.platform
    ),
    claudeJsonPath: claudeConfigFile(),
  });
}

function idleCompactMinTokens(env: Record<string, string | undefined>): number {
  return Math.max(IDLE_MIN_FLOOR, positiveTokens(env[IDLE_MIN_ENV]) ?? IDLE_MIN_DEFAULT);
}

function hookProjectDir(payload: CompactionHookPayload): string {
  return typeof payload.cwd === "string" && payload.cwd !== ""
    ? payload.cwd
    : process.cwd();
}

export function recordCompactionNear(payload: CompactionHookPayload | null): void {
  logQuietly("compaction_near", () => {
    if (!payload || isPalSpawnedInference() || !isClaude()) return;
    const transcriptPath = payload.transcript_path ?? undefined;
    const contextTokens = contextTokensOf(transcriptPath);
    if (contextTokens === null) return;
    const model = contextModelOf(transcriptPath);
    const compactionWindow = currentCompactionWindow(model, hookProjectDir(payload));
    if (!compactionWindow) return;
    const input = compactionInput(model, compactionWindow.tokens);
    const compactAtTokens = compactionPoint(input);
    const tokensLeft = compactAtTokens - contextTokens;
    const marginTokens = compactionMarginTokens(input);
    appendEvent(
      "compaction_near",
      {
        mode: "shadow",
        trigger: "threshold",
        contextTokens,
        windowTokens: compactionWindow.tokens,
        windowSource: compactionWindow.source,
        compactAtTokens,
        tokensLeft,
        marginTokens,
        predicted: compactionPredicted(tokensLeft, marginTokens),
      },
      { session: hookSessionId(payload) ?? null }
    );
  });
}

export function recordIdleCompactionNear(payload: CompactionHookPayload | null): void {
  logQuietly("compaction_near", () => {
    if (!payload || isPalSpawnedInference() || !isClaude()) return;
    const contextTokens = contextTokensOf(payload.transcript_path ?? undefined);
    if (contextTokens === null) return;
    const idleMinTokens = idleCompactMinTokens(process.env);
    if (contextTokens < idleMinTokens) return;
    const settingsFiles = claudeSettingsFiles(
      hookProjectDir(payload),
      platform.claudeDir(),
      process.platform
    );
    if (settingsFiles.some((file) => readJsonObject(file).idleCompaction === false))
      return;
    appendEvent(
      "compaction_near",
      { mode: "shadow", trigger: "idle", contextTokens, idleMinTokens, predicted: true },
      { session: hookSessionId(payload) ?? null }
    );
  });
}

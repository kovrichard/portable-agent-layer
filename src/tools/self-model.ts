#!/usr/bin/env bun
/**
 * SelfModel — Synthesize a first-person self-model from accumulated PAL data.
 *
 * Gathers data deterministically, then uses Sonnet to synthesize a genuine
 * first-person reflection. Reads opinions, ratings, wisdom frames,
 * graduated failure patterns, algorithm reflections, relationship notes,
 * and session history. Produces a self-aware narrative at
 * ~/.pal/memory/self-model/current.md that is injected at session start.
 *
 * Usage:
 *   bun ~/.pal/tools/self-model.ts [--days 30] [--force] [--dry-run]
 *
 * Every decision this makes lives in ./lib/self-model.ts, where the suite
 * reaches it directly; what stays here is paths, inference and the writes.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { inference } from "../hooks/lib/inference";
import { SONNET_MODEL } from "../hooks/lib/models";
import { ensureDir, paths } from "../hooks/lib/paths";
import { identity as loadSettingsIdentity } from "../hooks/lib/settings";
import { logTokenUsage } from "../hooks/lib/token-usage";
import {
  archiveDateOf,
  buildPrompt,
  failedSynthesisModel,
  formatDataForInference,
  gatherData,
  inferenceUserContent,
  metaFooter,
  type SelfModelSources,
  synthesisIsDue,
} from "./lib/self-model";

const HELP = `
SelfModel — Synthesize a first-person self-model from accumulated data

Usage:
  bun self-model.ts [--days 30] [--force] [--dry-run]

Options:
  --days     Lookback window (default: 30)
  --force    Skip 24h guard
  --dry-run  Print to stdout without writing

Output: ~/.pal/memory/self-model/current.md (synthesized by Sonnet)
`;

function selfModelDir(): string {
  return ensureDir(resolve(paths.memory(), "self-model"));
}

const selfModelPath = () => resolve(selfModelDir(), "current.md");
const selfModelMetaPath = () => resolve(selfModelDir(), "meta.json");

function sources(): SelfModelSources {
  return {
    opinionsFile: resolve(paths.relationship(), "opinions.json"),
    ratingsFile: resolve(paths.signals(), "ratings.jsonl"),
    wisdomDir: paths.wisdom(),
    graduatedFile: resolve(paths.wisdomState(), "graduated.json"),
    reflectionsFile: resolve(paths.reflections(), "algorithm-reflections.jsonl"),
    relationshipDir: paths.relationship(),
    sessionDir: resolve(paths.learning(), "session"),
  };
}

function readFileOrEmpty(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, "utf-8") : "";
  } catch {
    return "";
  }
}

async function composeSelfModel(days: number): Promise<string> {
  const data = gatherData(sources(), days);
  const { ai, principal } = loadSettingsIdentity();
  const rawData = formatDataForInference(data, principal.name);

  const result = await inference({
    system: buildPrompt(ai.name, principal.name),
    user: inferenceUserContent(rawData, readFileOrEmpty(selfModelPath())),
    model: SONNET_MODEL,
    maxTokens: 1500,
    timeout: 90000,
    caller: "self-model",
  });

  if (result.usage) logTokenUsage("self-model", result.usage, SONNET_MODEL);
  if (result.success && result.output) {
    return result.output.trimEnd() + metaFooter(data);
  }
  return failedSynthesisModel(ai.name, rawData);
}

function archivePrevious(modelPath: string, metaPath: string): void {
  if (!existsSync(modelPath)) return;
  try {
    const meta = existsSync(metaPath)
      ? (JSON.parse(readFileSync(metaPath, "utf-8")) as { timestamp?: string })
      : {};
    const archivePath = resolve(
      ensureDir(resolve(selfModelDir(), "archive")),
      `${archiveDateOf(meta, new Date())}.md`
    );
    if (!existsSync(archivePath)) copyFileSync(modelPath, archivePath);
  } catch {
    /* archive is best-effort */
  }
}

async function writeSelfModel(days: number, force: boolean): Promise<string | null> {
  const metaPath = selfModelMetaPath();
  const meta = existsSync(metaPath) ? readFileSync(metaPath, "utf-8") : null;
  if (!force && !synthesisIsDue(meta, new Date())) return null;

  const content = await composeSelfModel(days);
  const modelPath = selfModelPath();

  archivePrevious(modelPath, metaPath);
  writeFileSync(modelPath, content, "utf-8");
  writeFileSync(
    metaPath,
    JSON.stringify({ timestamp: new Date().toISOString(), days }, null, 2),
    "utf-8"
  );

  return modelPath;
}

async function run() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      days: { type: "string", default: "30" },
      force: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const days = Number.parseInt(values.days ?? "30", 10);

  if (values["dry-run"]) {
    console.log(await composeSelfModel(days));
    return;
  }

  const path = await writeSelfModel(days, values.force ?? false);

  if (path === null) {
    console.log(
      JSON.stringify({
        skipped: true,
        message: "Last self-model < 24h ago. Use --force to override.",
      })
    );
    return;
  }

  console.log(
    JSON.stringify(
      { success: true, path, days, message: `Self-model written (${days}-day window)` },
      null,
      2
    )
  );
}

if (import.meta.main) await run();

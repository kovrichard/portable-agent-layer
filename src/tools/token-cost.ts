/**
 * CLI tool: summarize token usage and estimated cost.
 *
 * Reads from two sources:
 * 1. Claude Code session transcripts (~/.claude/projects/)
 * 2. PAL Haiku inference logs (memory/signals/token-usage.jsonl)
 *
 * Usage: bun run tool:tokens [--today|--week|--month|--all] [--project <name>]
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { MODEL_PRICING } from "../hooks/lib/models";
import { palHome } from "../hooks/lib/paths";

// ── Types ──

export interface Bucket {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  cost: number;
  calls: number;
}

export function emptyBucket(): Bucket {
  return {
    input: 0,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    cost: 0,
    calls: 0,
  };
}

export interface TimeBuckets {
  today: Bucket;
  week: Bucket;
  month: Bucket;
  total: Bucket;
}

export function emptyTimeBuckets(): TimeBuckets {
  return {
    today: emptyBucket(),
    week: emptyBucket(),
    month: emptyBucket(),
    total: emptyBucket(),
  };
}

// ── Helpers ──

function findPricing(model: string): (typeof MODEL_PRICING)[string] | null {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const key of Object.keys(MODEL_PRICING)) {
    if (model.startsWith(key)) return MODEL_PRICING[key];
  }
  return null;
}

function costForUsage(
  model: string,
  input: number,
  output: number,
  cacheWrite5m: number,
  cacheWrite1h: number,
  cacheRead: number
): number {
  const p = findPricing(model);
  if (!p) return 0;
  return (
    (input * p.input +
      output * p.output +
      cacheWrite5m * p.cacheWrite5m +
      cacheWrite1h * p.cacheWrite1h +
      cacheRead * p.cacheRead) /
    1_000_000
  );
}

export function addToBucket(
  bucket: Bucket,
  model: string,
  input: number,
  output: number,
  cacheWrite5m: number,
  cacheWrite1h: number,
  cacheRead: number
): void {
  bucket.input += input;
  bucket.output += output;
  bucket.cacheWrite5m += cacheWrite5m;
  bucket.cacheWrite1h += cacheWrite1h;
  bucket.cacheRead += cacheRead;
  bucket.cost += costForUsage(
    model,
    input,
    output,
    cacheWrite5m,
    cacheWrite1h,
    cacheRead
  );
  bucket.calls++;
}

// ── Formatting ──

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

function fmtCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function printRow(label: string, b: Bucket, labelWidth = 14): void {
  const tokens = b.input + b.output + b.cacheWrite5m + b.cacheWrite1h + b.cacheRead;
  console.log(
    `  ${label.padEnd(labelWidth)} ${fmt(tokens).padStart(8)} tok  ${fmt(b.calls).padStart(5)} calls  ${fmtCost(b.cost).padStart(8)}`
  );
}

function printDetailed(label: string, b: Bucket, labelWidth = 14): void {
  console.log(
    `  ${label.padEnd(labelWidth)} ${fmt(b.input).padStart(8)} in  ${fmt(b.output).padStart(8)} out  ${fmt(b.cacheWrite5m).padStart(7)} cw5m  ${fmt(b.cacheWrite1h).padStart(7)} cw1h  ${fmt(b.cacheRead).padStart(8)} cr  ${fmtCost(b.cost).padStart(8)}`
  );
}

// ── Claude Code transcripts ──

function addToTimeBuckets(
  tb: TimeBuckets,
  ts: string,
  model: string,
  input: number,
  output: number,
  cacheWrite5m: number,
  cacheWrite1h: number,
  cacheRead: number,
  todayPrefix: string,
  weekAgo: string,
  monthAgo: string
): void {
  addToBucket(tb.total, model, input, output, cacheWrite5m, cacheWrite1h, cacheRead);
  if (ts >= monthAgo)
    addToBucket(tb.month, model, input, output, cacheWrite5m, cacheWrite1h, cacheRead);
  if (ts >= weekAgo)
    addToBucket(tb.week, model, input, output, cacheWrite5m, cacheWrite1h, cacheRead);
  if (ts.startsWith(todayPrefix))
    addToBucket(tb.today, model, input, output, cacheWrite5m, cacheWrite1h, cacheRead);
}

export function readClaudeCode(projectFilter?: string): {
  buckets: TimeBuckets;
  byModel: Record<string, Bucket>;
  byProject: Record<string, TimeBuckets>;
} {
  const now = new Date();
  const todayPrefix = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const buckets = emptyTimeBuckets();
  const byModel: Record<string, Bucket> = {};
  const byProject: Record<string, TimeBuckets> = {};

  const claudeDir = resolve(homedir(), ".claude", "projects");
  if (!existsSync(claudeDir)) return { buckets, byModel, byProject };

  const projectDirs = readdirSync(claudeDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const projDir of projectDirs) {
    const projPath = resolve(claudeDir, projDir);
    const segments = projDir.replace(/^-/, "").split("-");
    const projName = segments.length > 1 ? segments.slice(-1)[0] : projDir;

    if (typeof projectFilter === "string" && !projName.includes(projectFilter)) continue;

    const jsonlFiles: string[] = [];

    for (const entry of readdirSync(projPath, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        jsonlFiles.push(resolve(projPath, entry.name));
      } else if (entry.isDirectory()) {
        const subagentsDir = resolve(projPath, entry.name, "subagents");
        try {
          for (const sub of readdirSync(subagentsDir)) {
            if (sub.endsWith(".jsonl")) {
              jsonlFiles.push(resolve(subagentsDir, sub));
            }
          }
        } catch {
          /* no subagents dir */
        }
      }
    }

    for (const filepath of jsonlFiles) {
      let content: string;
      try {
        content = readFileSync(filepath, "utf-8");
      } catch {
        continue;
      }

      for (const line of content.split("\n")) {
        if (!line.includes('"usage"')) continue;
        try {
          const d = JSON.parse(line) as {
            type?: string;
            timestamp?: string;
            message?: {
              model?: string;
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                cache_creation_input_tokens?: number;
                cache_read_input_tokens?: number;
                cache_creation?: {
                  ephemeral_5m_input_tokens?: number;
                  ephemeral_1h_input_tokens?: number;
                };
              };
            };
          };
          if (d.type !== "assistant") continue;
          const usage = d.message?.usage;
          const model = d.message?.model;
          const ts = d.timestamp;
          if (!usage || !model || !ts) continue;

          const input = usage.input_tokens ?? 0;
          const output = usage.output_tokens ?? 0;
          const cr = usage.cache_read_input_tokens ?? 0;
          const cw5m = usage.cache_creation?.ephemeral_5m_input_tokens;
          const cw1h = usage.cache_creation?.ephemeral_1h_input_tokens;
          // Older transcripts only have the summed cache_creation_input_tokens — bill as 5m.
          const hasBreakdown = cw5m !== undefined || cw1h !== undefined;
          const cacheWrite5m = hasBreakdown
            ? (cw5m ?? 0)
            : (usage.cache_creation_input_tokens ?? 0);
          const cacheWrite1h = cw1h ?? 0;

          addToTimeBuckets(
            buckets,
            ts,
            model,
            input,
            output,
            cacheWrite5m,
            cacheWrite1h,
            cr,
            todayPrefix,
            weekAgo,
            monthAgo
          );

          if (!byModel[model]) byModel[model] = emptyBucket();
          addToBucket(
            byModel[model],
            model,
            input,
            output,
            cacheWrite5m,
            cacheWrite1h,
            cr
          );

          if (!byProject[projName]) byProject[projName] = emptyTimeBuckets();
          addToTimeBuckets(
            byProject[projName],
            ts,
            model,
            input,
            output,
            cacheWrite5m,
            cacheWrite1h,
            cr,
            todayPrefix,
            weekAgo,
            monthAgo
          );
        } catch {
          /* skip */
        }
      }
    }
  }

  return { buckets, byModel, byProject };
}

// ── PAL inference ──

export function readPalInference(): {
  buckets: TimeBuckets;
  byModel: Record<string, TimeBuckets>;
  byCaller: Record<string, Bucket>;
} {
  const now = new Date();
  const todayPrefix = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const buckets = emptyTimeBuckets();
  const byModel: Record<string, TimeBuckets> = {};
  const byCaller: Record<string, Bucket> = {};

  const filepath = resolve(palHome(), "memory", "signals", "token-usage.jsonl");
  if (!existsSync(filepath)) return { buckets, byModel, byCaller };

  const content = readFileSync(filepath, "utf-8").trim();
  if (!content) return { buckets, byModel, byCaller };

  for (const line of content.split("\n")) {
    try {
      const e = JSON.parse(line) as {
        ts: string;
        caller: string;
        model: string;
        inputTokens: number;
        outputTokens: number;
      };
      addToTimeBuckets(
        buckets,
        e.ts,
        e.model,
        e.inputTokens,
        e.outputTokens,
        0,
        0,
        0,
        todayPrefix,
        weekAgo,
        monthAgo
      );
      if (!byModel[e.model]) byModel[e.model] = emptyTimeBuckets();
      addToTimeBuckets(
        byModel[e.model],
        e.ts,
        e.model,
        e.inputTokens,
        e.outputTokens,
        0,
        0,
        0,
        todayPrefix,
        weekAgo,
        monthAgo
      );
      if (!byCaller[e.caller]) byCaller[e.caller] = emptyBucket();
      addToBucket(byCaller[e.caller], e.model, e.inputTokens, e.outputTokens, 0, 0, 0);
    } catch {
      /* skip */
    }
  }

  return { buckets, byModel, byCaller };
}

// ── CLI ──

function run() {
  parseArgs({
    options: {
      today: { type: "boolean", default: false },
      week: { type: "boolean", default: false },
      month: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      project: { type: "string" },
    },
    strict: false,
  });

  const cc = readClaudeCode();
  const pal = readPalInference();

  console.log("\n  Claude Code Usage\n");
  printRow("Today", cc.buckets.today);
  printRow("7d", cc.buckets.week);
  printRow("30d", cc.buckets.month);
  printRow("Total", cc.buckets.total);

  if (Object.keys(cc.byModel).length > 0) {
    console.log("\n  By Model (all time)\n");
    const sorted = Object.entries(cc.byModel).sort((a, b) => b[1].cost - a[1].cost);
    const modelNames = sorted.map(([m]) => m.replace("claude-", ""));
    const modelWidth = Math.max(14, ...modelNames.map((n) => n.length + 2));
    for (let i = 0; i < sorted.length; i++) {
      printDetailed(modelNames[i], sorted[i][1], modelWidth);
    }
  }

  if (Object.keys(cc.byProject).length > 1) {
    console.log("\n  By Project (all time)\n");
    const sorted = Object.entries(cc.byProject).sort(
      (a, b) => b[1].total.cost - a[1].total.cost
    );
    for (const [proj, tb] of sorted) {
      printRow(proj, tb.total);
    }
  }

  for (const [model, tb] of Object.entries(pal.byModel)) {
    if (tb.total.calls === 0) continue;
    const label = model.includes("haiku")
      ? "Haiku"
      : model.includes("sonnet")
        ? "Sonnet"
        : model.replace("claude-", "");
    console.log(`\n  PAL Inference (${label})\n`);
    printRow("Today", tb.today);
    printRow("7d", tb.week);
    printRow("30d", tb.month);
    printRow("Total", tb.total);
  }

  const grand = emptyBucket();
  for (const b of [cc.buckets.total, pal.buckets.total]) {
    grand.input += b.input;
    grand.output += b.output;
    grand.cacheWrite5m += b.cacheWrite5m;
    grand.cacheWrite1h += b.cacheWrite1h;
    grand.cacheRead += b.cacheRead;
    grand.cost += b.cost;
    grand.calls += b.calls;
  }

  console.log(`\n  Grand Total: ${fmtCost(grand.cost)}\n`);
}

if (import.meta.main) run();

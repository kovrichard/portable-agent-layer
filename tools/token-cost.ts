/**
 * CLI tool: summarize Haiku token usage and estimated cost.
 * Usage: bun run tool:tokens
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MODEL_PRICING } from "../hooks/lib/models";

interface Entry {
  ts: string;
  caller: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

const filepath = resolve(import.meta.dir, "..", "memory", "signals", "token-usage.jsonl");

if (!existsSync(filepath)) {
  console.log("No token usage data yet.");
  process.exit(0);
}

const lines = readFileSync(filepath, "utf-8").trim().split("\n");
const entries: Entry[] = [];
for (const line of lines) {
  try {
    entries.push(JSON.parse(line) as Entry);
  } catch {
    /* skip */
  }
}

if (entries.length === 0) {
  console.log("No token usage data yet.");
  process.exit(0);
}

const now = new Date();
const todayPrefix = now.toISOString().slice(0, 10);
const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

interface Bucket {
  input: number;
  output: number;
  cost: number;
  calls: number;
}

function emptyBucket(): Bucket {
  return { input: 0, output: 0, cost: 0, calls: 0 };
}

function addEntry(bucket: Bucket, e: Entry): void {
  const pricing = MODEL_PRICING[e.model];
  if (!pricing) return;
  bucket.input += e.inputTokens;
  bucket.output += e.outputTokens;
  bucket.cost +=
    (e.inputTokens * pricing.input + e.outputTokens * pricing.output) / 1_000_000;
  bucket.calls++;
}

const today = emptyBucket();
const week = emptyBucket();
const month = emptyBucket();
const total = emptyBucket();
const byCaller: Record<string, Bucket> = {};

for (const e of entries) {
  addEntry(total, e);
  if (e.ts >= monthAgo) addEntry(month, e);
  if (e.ts >= weekAgo) addEntry(week, e);
  if (e.ts.startsWith(todayPrefix)) addEntry(today, e);

  if (!byCaller[e.caller]) byCaller[e.caller] = emptyBucket();
  addEntry(byCaller[e.caller], e);
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

function printBucket(label: string, b: Bucket): void {
  console.log(
    `  ${label.padEnd(8)} ${fmt(b.input).padStart(10)} in  ${fmt(b.output).padStart(10)} out  ${fmt(b.calls).padStart(5)} calls  ${fmtCost(b.cost).padStart(8)}`
  );
}

console.log("\n  Token Usage & Cost Estimate\n");
printBucket("Today", today);
printBucket("7d", week);
printBucket("30d", month);
printBucket("Total", total);

console.log("\n  By Caller (all time)\n");
const sorted = Object.entries(byCaller).sort((a, b) => b[1].cost - a[1].cost);
for (const [caller, bucket] of sorted) {
  printBucket(caller, bucket);
}

console.log();

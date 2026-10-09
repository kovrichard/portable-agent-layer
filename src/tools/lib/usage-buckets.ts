/**
 * What has been spent: the buckets every agent's reader fills, Claude Code's
 * transcripts, and PAL's inference log. Readers take the directory to read
 * rather than finding it themselves, which is what makes them testable.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { costOfUsage } from "../../hooks/lib/models";
import { cacheWritesOf, type TranscriptUsage } from "./transcript-usage";

export interface Bucket {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  cost: number;
  calls: number;
  unpriced: number;
}

export interface TimeBuckets {
  today: Bucket;
  week: Bucket;
  month: Bucket;
  total: Bucket;
}

/** The tokens of one call, before they are priced. */
export interface Tokens {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface Horizons {
  todayPrefix: string;
  weekAgo: string;
  monthAgo: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function emptyBucket(): Bucket {
  return {
    input: 0,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    cost: 0,
    calls: 0,
    unpriced: 0,
  };
}

export function emptyTimeBuckets(): TimeBuckets {
  return {
    today: emptyBucket(),
    week: emptyBucket(),
    month: emptyBucket(),
    total: emptyBucket(),
  };
}

/**
 * The cutoffs, as strings, because an ISO timestamp sorts lexically and
 * comparing strings avoids parsing a Date per transcript line.
 */
export function horizonsFrom(now: Date): Horizons {
  return {
    todayPrefix: now.toISOString().slice(0, 10),
    weekAgo: new Date(now.getTime() - 7 * DAY_MS).toISOString(),
    monthAgo: new Date(now.getTime() - 30 * DAY_MS).toISOString(),
  };
}

/** A null cost is a call the agent does not bill per token; its tokens still count. */
function addCall(bucket: Bucket, tokens: Tokens, cost: number | null, calls = 1): void {
  bucket.input += tokens.input;
  bucket.output += tokens.output;
  bucket.cacheWrite5m += tokens.cacheWrite5m;
  bucket.cacheWrite1h += tokens.cacheWrite1h;
  bucket.cacheRead += tokens.cacheRead;
  bucket.cost += cost ?? 0;
  bucket.calls += calls;
  if (cost === null) bucket.unpriced += calls;
}

export function addToBucket(bucket: Bucket, model: string, tokens: Tokens): void {
  addCall(bucket, tokens, costOfUsage(model, tokens));
}

/**
 * The windows nest: everything in today is also in the week, the month and the
 * total, so a call is added to every window it falls inside rather than to one.
 */
function addToWindows(
  buckets: TimeBuckets,
  ts: string,
  horizons: Horizons,
  add: (bucket: Bucket) => void
): void {
  add(buckets.total);
  if (ts >= horizons.monthAgo) add(buckets.month);
  if (ts >= horizons.weekAgo) add(buckets.week);
  if (ts.startsWith(horizons.todayPrefix)) add(buckets.today);
}

export function addToTimeBuckets(
  buckets: TimeBuckets,
  ts: string,
  model: string,
  tokens: Tokens,
  horizons: Horizons
): void {
  addToWindows(buckets, ts, horizons, (bucket) => addToBucket(bucket, model, tokens));
}

export function totalTokens(bucket: Bucket): number {
  return (
    bucket.input +
    bucket.output +
    bucket.cacheWrite5m +
    bucket.cacheWrite1h +
    bucket.cacheRead
  );
}

/** Claude Code names a project directory after its path; the last segment is the repo. */
export function projectNameOf(dirName: string): string {
  const segments = dirName.replace(/^-/, "").split("-");
  return segments.length > 1 ? segments.slice(-1)[0] : dirName;
}

export interface AgentUsage {
  buckets: TimeBuckets;
  byModel: Record<string, Bucket>;
  byProject: Record<string, TimeBuckets>;
}

export function emptyAgentUsage(): AgentUsage {
  return { buckets: emptyTimeBuckets(), byModel: {}, byProject: {} };
}

/** One or more model calls of a session, as every agent's reader hands them over. */
interface UsageCall {
  ts: string;
  model: string;
  project: string;
  tokens: Tokens;
  cost: number | null;
  calls?: number;
}

export interface UsageTally {
  usage: AgentUsage;
  record: (call: UsageCall) => void;
}

export function usageTally(projectFilter?: string, now: Date = new Date()): UsageTally {
  const horizons = horizonsFrom(now);
  const usage = emptyAgentUsage();
  const record = (call: UsageCall) => {
    if (typeof projectFilter === "string" && !call.project.includes(projectFilter))
      return;
    const add = (bucket: Bucket) => addCall(bucket, call.tokens, call.cost, call.calls);
    addToWindows(usage.buckets, call.ts, horizons, add);
    usage.byModel[call.model] ??= emptyBucket();
    add(usage.byModel[call.model]);
    usage.byProject[call.project] ??= emptyTimeBuckets();
    addToWindows(usage.byProject[call.project], call.ts, horizons, add);
  };
  return { usage, record };
}

interface TranscriptLine {
  type?: string;
  timestamp?: string;
  message?: { model?: string; usage?: TranscriptUsage };
}

/**
 * Every transcript under a project directory, including the ones a subagent
 * wrote — those sit one level down and are billed to the same project, so
 * missing them undercounts every session that spawned one.
 */
function transcriptsIn(projPath: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(projPath, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(resolve(projPath, entry.name));
      continue;
    }
    if (!entry.isDirectory()) continue;
    const subagentsDir = resolve(projPath, entry.name, "subagents");
    try {
      for (const sub of readdirSync(subagentsDir)) {
        if (sub.endsWith(".jsonl")) files.push(resolve(subagentsDir, sub));
      }
    } catch {
      /* no subagents dir */
    }
  }
  return files;
}

interface PricedCall {
  ts: string;
  model: string;
  tokens: Tokens;
}

/** Null for anything that is not a priced assistant turn. */
function pricedCallOf(line: string): PricedCall | null {
  let entry: TranscriptLine;
  try {
    entry = JSON.parse(line) as TranscriptLine;
  } catch {
    return null;
  }
  if (entry.type !== "assistant") return null;

  const usage = entry.message?.usage;
  const model = entry.message?.model;
  const ts = entry.timestamp;
  if (!usage || !model || !ts) return null;

  return {
    ts,
    model,
    tokens: {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      ...cacheWritesOf(usage),
    },
  };
}

export function readClaudeCode(
  claudeDir: string,
  projectFilter?: string,
  now: Date = new Date()
): AgentUsage {
  const tally = usageTally(projectFilter, now);
  if (!existsSync(claudeDir)) return tally.usage;

  const projectDirs = readdirSync(claudeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const dirName of projectDirs) {
    const projName = projectNameOf(dirName);
    if (typeof projectFilter === "string" && !projName.includes(projectFilter)) continue;

    for (const filepath of transcriptsIn(resolve(claudeDir, dirName))) {
      let content: string;
      try {
        content = readFileSync(filepath, "utf-8");
      } catch {
        continue;
      }

      for (const line of content.split("\n")) {
        // Cheap reject before the parse: most lines are not model turns.
        if (!line.includes('"usage"')) continue;
        const call = pricedCallOf(line);
        if (!call) continue;
        tally.record({
          ...call,
          project: projName,
          cost: costOfUsage(call.model, call.tokens),
        });
      }
    }
  }

  return tally.usage;
}

export interface PalInferenceUsage {
  buckets: TimeBuckets;
  byModel: Record<string, TimeBuckets>;
  byCaller: Record<string, Bucket>;
}

interface InferenceLine {
  ts: string;
  caller: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** PAL's own calls are plain prompts: no cache to write and none to read. */
function inferenceTokens(entry: InferenceLine): Tokens {
  return {
    input: entry.inputTokens,
    output: entry.outputTokens,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
  };
}

export function readPalInference(
  filepath: string,
  now: Date = new Date()
): PalInferenceUsage {
  const horizons = horizonsFrom(now);
  const result: PalInferenceUsage = {
    buckets: emptyTimeBuckets(),
    byModel: {},
    byCaller: {},
  };
  if (!existsSync(filepath)) return result;

  const content = readFileSync(filepath, "utf-8").trim();
  if (!content) return result;

  for (const line of content.split("\n")) {
    let entry: InferenceLine;
    try {
      entry = JSON.parse(line) as InferenceLine;
    } catch {
      continue;
    }
    const tokens = inferenceTokens(entry);

    addToTimeBuckets(result.buckets, entry.ts, entry.model, tokens, horizons);

    result.byModel[entry.model] ??= emptyTimeBuckets();
    addToTimeBuckets(
      result.byModel[entry.model],
      entry.ts,
      entry.model,
      tokens,
      horizons
    );

    result.byCaller[entry.caller] ??= emptyBucket();
    addToBucket(result.byCaller[entry.caller], entry.model, tokens);
  }

  return result;
}

export function grandTotal(buckets: Bucket[]): Bucket {
  const grand = emptyBucket();
  for (const bucket of buckets) {
    grand.input += bucket.input;
    grand.output += bucket.output;
    grand.cacheWrite5m += bucket.cacheWrite5m;
    grand.cacheWrite1h += bucket.cacheWrite1h;
    grand.cacheRead += bucket.cacheRead;
    grand.cost += bucket.cost;
    grand.calls += bucket.calls;
    grand.unpriced += bucket.unpriced;
  }
  return grand;
}

export function mergeTimeBuckets(all: TimeBuckets[]): TimeBuckets {
  return {
    today: grandTotal(all.map((b) => b.today)),
    week: grandTotal(all.map((b) => b.week)),
    month: grandTotal(all.map((b) => b.month)),
    total: grandTotal(all.map((b) => b.total)),
  };
}

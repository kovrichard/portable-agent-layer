/**
 * The usage report, as lines rather than as console output.
 *
 * Every judgement about what the report shows — which sections appear at all,
 * how a model is named, what "no data" looks like — was written straight into
 * console.log inside a spawned tool, so none of it could be read back.
 */

import {
  type Bucket,
  type ClaudeCodeUsage,
  grandTotal,
  type PalInferenceUsage,
  totalTokens,
} from "./usage-buckets";

export interface RtkSummary {
  total_commands: number;
  total_saved: number;
  avg_savings_pct: number;
}

/**
 * `installed: false` means rtk isn't on PATH; `summary: null` with
 * `installed: true` means rtk is present but has nothing to report — the two
 * cases print differently.
 */
export interface RtkGain {
  installed: boolean;
  summary: RtkSummary | null;
}

const DEFAULT_LABEL_WIDTH = 14;

export function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

/** Two decimals reads as money; a sub-dollar total needs four to say anything. */
export function fmtCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function rowLine(
  label: string,
  b: Bucket,
  labelWidth = DEFAULT_LABEL_WIDTH
): string {
  const tokens = fmt(totalTokens(b)).padStart(8);
  const calls = fmt(b.calls).padStart(5);
  const cost = fmtCost(b.cost).padStart(8);
  return `  ${label.padEnd(labelWidth)} ${tokens} tok  ${calls} calls  ${cost}`;
}

export function detailedLine(
  label: string,
  b: Bucket,
  labelWidth = DEFAULT_LABEL_WIDTH
): string {
  const input = fmt(b.input).padStart(8);
  const output = fmt(b.output).padStart(8);
  const write5m = fmt(b.cacheWrite5m).padStart(7);
  const write1h = fmt(b.cacheWrite1h).padStart(7);
  const read = fmt(b.cacheRead).padStart(8);
  const cost = fmtCost(b.cost).padStart(8);
  return `  ${label.padEnd(labelWidth)} ${input} in  ${output} out  ${write5m} cw5m  ${write1h} cw1h  ${read} cr  ${cost}`;
}

function windowLines(buckets: {
  today: Bucket;
  week: Bucket;
  month: Bucket;
  total: Bucket;
}): string[] {
  return [
    rowLine("Today", buckets.today),
    rowLine("7d", buckets.week),
    rowLine("30d", buckets.month),
    rowLine("Total", buckets.total),
  ];
}

/** Costliest first — the point of the section is what to look at. */
function byCost<T>(entries: [string, T][], costOf: (value: T) => number): [string, T][] {
  return entries.sort((a, b) => costOf(b[1]) - costOf(a[1]));
}

function byModelLines(byModel: ClaudeCodeUsage["byModel"]): string[] {
  const sorted = byCost(Object.entries(byModel), (bucket) => bucket.cost);
  if (sorted.length === 0) return [];
  const names = sorted.map(([model]) => model.replace("claude-", ""));
  const width = Math.max(DEFAULT_LABEL_WIDTH, ...names.map((name) => name.length + 2));
  return [
    "\n  By Model (all time)\n",
    ...sorted.map(([, bucket], i) => detailedLine(names[i], bucket, width)),
  ];
}

/** One project is the project you are in; a breakdown of it says nothing new. */
function byProjectLines(byProject: ClaudeCodeUsage["byProject"]): string[] {
  const entries = Object.entries(byProject);
  if (entries.length <= 1) return [];
  const sorted = byCost(entries, (buckets) => buckets.total.cost);
  return [
    "\n  By Project (all time)\n",
    ...sorted.map(([project, buckets]) => rowLine(project, buckets.total)),
  ];
}

function inferenceLabel(model: string): string {
  if (model.includes("haiku")) return "Haiku";
  if (model.includes("sonnet")) return "Sonnet";
  return model.replace("claude-", "");
}

function palInferenceLines(byModel: PalInferenceUsage["byModel"]): string[] {
  const lines: string[] = [];
  for (const [model, buckets] of Object.entries(byModel)) {
    if (buckets.total.calls === 0) continue;
    lines.push(`\n  PAL Inference (${inferenceLabel(model)})\n`, ...windowLines(buckets));
  }
  return lines;
}

export function rtkLines(gain: RtkGain): string[] {
  const heading = "\n  rtk Compression\n";
  if (!gain.installed) return [heading, "  rtk not installed"];
  const summary = gain.summary;
  if (!summary || summary.total_commands === 0) {
    return [heading, "  rtk installed — no savings recorded yet"];
  }
  const saved = fmt(summary.total_saved).padStart(8);
  const pct = summary.avg_savings_pct.toFixed(1);
  const commands = fmt(summary.total_commands);
  return [
    heading,
    `  Tokens saved   ${saved} tok  ${pct}% avg  across ${commands} commands`,
  ];
}

/** Null for anything rtk did not answer cleanly — the report says so either way. */
export function parseRtkSummary(
  status: number | null,
  stdout: string
): RtkSummary | null {
  if (status !== 0 || !stdout) return null;
  try {
    const parsed = JSON.parse(stdout) as { summary?: RtkSummary };
    return parsed.summary ?? null;
  } catch {
    return null;
  }
}

export function usageLines(
  claudeCode: ClaudeCodeUsage,
  pal: PalInferenceUsage,
  rtk: RtkGain
): string[] {
  const grand = grandTotal([claudeCode.buckets.total, pal.buckets.total]);
  return [
    "\n  Claude Code Usage\n",
    ...windowLines(claudeCode.buckets),
    ...byModelLines(claudeCode.byModel),
    ...byProjectLines(claudeCode.byProject),
    ...palInferenceLines(pal.byModel),
    ...rtkLines(rtk),
    `\n  Grand Total: ${fmtCost(grand.cost)}\n`,
  ];
}

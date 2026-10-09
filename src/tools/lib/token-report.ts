/**
 * The usage report, as lines rather than as console output.
 *
 * Every judgement about what the report shows — which sections appear at all,
 * how a model is named, what "no data" looks like — was written straight into
 * console.log inside a spawned tool, so none of it could be read back.
 */

import {
  type AgentUsage,
  type Bucket,
  grandTotal,
  mergeTimeBuckets,
  type PalInferenceUsage,
  type TimeBuckets,
  totalTokens,
} from "./usage-buckets";

export interface AgentReport {
  label: string;
  usage: AgentUsage;
}

/** `untracked` names the agents on this machine that keep no token counts at all. */
export interface UsageData {
  agents: AgentReport[];
  pal: PalInferenceUsage;
  rtk: RtkGain;
  untracked: string[];
}

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

/** A bucket whose every call went unpriced has no cost to show, which is not $0. */
export function costLabel(b: Bucket, dash = "-"): string {
  return b.calls > 0 && b.unpriced === b.calls ? dash : fmtCost(b.cost);
}

export function rowLine(
  label: string,
  b: Bucket,
  labelWidth = DEFAULT_LABEL_WIDTH
): string {
  const tokens = fmt(totalTokens(b)).padStart(8);
  const calls = fmt(b.calls).padStart(5);
  const cost = costLabel(b).padStart(8);
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
  const cost = costLabel(b).padStart(8);
  return `  ${label.padEnd(labelWidth)} ${input} in  ${output} out  ${write5m} cw5m  ${write1h} cw1h  ${read} cr  ${cost}`;
}

export const WINDOWS = [
  ["Today", "today"],
  ["7d", "week"],
  ["30d", "month"],
  ["Total", "total"],
] as const satisfies readonly (readonly [string, keyof TimeBuckets])[];

function windowLines(buckets: TimeBuckets): string[] {
  return WINDOWS.map(([label, window]) => rowLine(label, buckets[window]));
}

/** Costliest first — the point of the section is what to look at. */
function byCost<T>(entries: [string, T][], costOf: (value: T) => number): [string, T][] {
  return entries.sort((a, b) => costOf(b[1]) - costOf(a[1]));
}

/** Drops the vendor's prefix and any provider path, so `accounts/x/models/kimi` reads `kimi`. */
export function modelLabel(model: string): string {
  return (model.split("/").at(-1) ?? model).replace("claude-", "");
}

export const usedAgents = (agents: AgentReport[]) =>
  agents.filter((agent) => agent.usage.buckets.total.calls > 0);

function mergedEntries<T>(
  agents: AgentReport[],
  pick: (usage: AgentUsage) => Record<string, T>,
  merge: (all: T[]) => T
): [string, T][] {
  const grouped = new Map<string, T[]>();
  for (const { usage } of agents) {
    for (const [key, value] of Object.entries(pick(usage))) {
      grouped.set(key, [...(grouped.get(key) ?? []), value]);
    }
  }
  return [...grouped].map(([key, all]) => [key, merge(all)]);
}

export function modelsByCost(agents: AgentReport[]): [string, Bucket][] {
  return byCost(
    mergedEntries(agents, (usage) => usage.byModel, grandTotal),
    (bucket) => bucket.cost
  );
}

/** One project is the project you are in; a breakdown of it says nothing new. */
export function projectsByCost(agents: AgentReport[]): [string, TimeBuckets][] {
  const entries = mergedEntries(agents, (usage) => usage.byProject, mergeTimeBuckets);
  return entries.length <= 1 ? [] : byCost(entries, (buckets) => buckets.total.cost);
}

function byModelLines(agents: AgentReport[]): string[] {
  const sorted = modelsByCost(agents);
  if (sorted.length === 0) return [];
  const names = sorted.map(([model]) => modelLabel(model));
  const width = Math.max(DEFAULT_LABEL_WIDTH, ...names.map((name) => name.length + 2));
  return [
    "\n  By Model (all time)\n",
    ...sorted.map(([, bucket], i) => detailedLine(names[i], bucket, width)),
  ];
}

function byProjectLines(agents: AgentReport[]): string[] {
  const sorted = projectsByCost(agents);
  if (sorted.length === 0) return [];
  return [
    "\n  By Project (all time)\n",
    ...sorted.map(([project, buckets]) => rowLine(project, buckets.total)),
  ];
}

export function inferenceLabel(model: string): string {
  if (model.includes("haiku")) return "Haiku";
  if (model.includes("sonnet")) return "Sonnet";
  return model.replace("claude-", "");
}

export const usedInferenceModels = (pal: PalInferenceUsage) =>
  Object.entries(pal.byModel).filter(([, buckets]) => buckets.total.calls > 0);

function palInferenceLines(pal: PalInferenceUsage): string[] {
  return usedInferenceModels(pal).flatMap(([model, buckets]) => [
    `\n  PAL Inference (${inferenceLabel(model)})\n`,
    ...windowLines(buckets),
  ]);
}

function agentLines(agents: AgentReport[]): string[] {
  const used = usedAgents(agents);
  if (used.length === 0) return ["\n  No agent usage recorded\n"];
  return used.flatMap(({ label, usage }) => [
    `\n  ${label} Usage\n`,
    ...windowLines(usage.buckets),
  ]);
}

function untrackedLines(untracked: string[]): string[] {
  return untracked.length === 0
    ? []
    : [`\n  ${untracked.join(", ")}: no token counts recorded`];
}

export function grandBucket(data: UsageData): Bucket {
  return grandTotal([
    ...data.agents.map((agent) => agent.usage.buckets.total),
    data.pal.buckets.total,
  ]);
}

/** The agents whose spend the grand total cannot include, because they bill otherwise. */
export function unpricedAgents(agents: AgentReport[]): string[] {
  return agents
    .filter((agent) => agent.usage.buckets.total.unpriced > 0)
    .map((agent) => agent.label);
}

function unpricedLines(agents: AgentReport[]): string[] {
  const unpriced = unpricedAgents(agents);
  return unpriced.length === 0
    ? []
    : [`\n  Not priced: ${unpriced.join(", ")} (no per-token price)`];
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

export function usageLines(data: UsageData): string[] {
  return [
    ...agentLines(data.agents),
    ...untrackedLines(data.untracked),
    ...byModelLines(data.agents),
    ...byProjectLines(data.agents),
    ...palInferenceLines(data.pal),
    ...rtkLines(data.rtk),
    ...unpricedLines(data.agents),
    `\n  Grand Total: ${fmtCost(grandBucket(data).cost)}\n`,
  ];
}

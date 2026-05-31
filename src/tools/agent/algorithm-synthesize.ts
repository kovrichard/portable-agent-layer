#!/usr/bin/env bun
/**
 * algorithm-synthesize — surface the Q2 field ("what a smarter algorithm would
 * have done") across algorithm reflections, pre-sorted into candidate areas, to
 * drive the periodic algorithm-update session: the loop from collected
 * reflections back into ALGORITHM.md itself.
 *
 * IMPORTANT — the keyword BUCKETS are a *heuristic pre-sort hint only*, biased to
 * the current model's English phrasing. They are NOT the clustering authority:
 * another model wording the same idea differently ("double-check the assumption"
 * vs "verify the premise") will not match. The real clustering is semantic, done
 * by the model reading this report in the session. Therefore the tool NEVER drops
 * data — every unmatched Q2 is surfaced in full under "Unbucketed", so nothing is
 * invisible even when (especially when) the keyword sort misses or mis-sorts it.
 *
 * Library:  import { synthesizeAlgorithm, formatAlgorithmReport } from ".../algorithm-synthesize"
 * Script:   bun src/tools/agent/algorithm-synthesize.ts [--since <ISO>] [--json]
 */

import { parseArgs } from "node:util";
import { readReflections } from "../../hooks/lib/learning-store";
import { paths } from "../../hooks/lib/paths";

/** Algorithm areas a Q2 idea can target, mapped to ALGORITHM.md structure. */
const BUCKETS: { key: string; label: string; patterns: RegExp }[] = [
  {
    key: "verify-gate",
    label: "Establish grounding before acting (verify a fact / prerequisite first)",
    patterns:
      /pre-?check|pre-?mortem|premise|primary source|verif\w+|reproduce|before (writ|cod|propos|assert|implement|build|run|any|attempt|fetch|explor)|dependency scan|sanity-check|confirm .* before|prerequisite|gate (in|before)|trace .* first|check\w* .* before|anchor on|upfront|connectivity before|resolve .* before|triangulat|contradiction-detection|credibility gate|escalation|after \d+ (failed|iteration)/i,
  },
  {
    key: "criteria",
    label: "Criteria quality (atomicity, splitting, coverage, anti-criteria)",
    patterns: /criteri|atomic|anti-criter|split .* criter|a .* criterion|enumerate/i,
  },
  {
    key: "capability",
    label: "Capability selection (plan mode, subagents, parallelism, research)",
    patterns:
      /capabilit|plan ?mode|askuser|sub-?agent|parallel|in one (agent|batch)|research|worktree/i,
  },
  {
    key: "read-first",
    label: "Read existing code/docs first (prior-artifact / context scan)",
    patterns:
      /read (the|existing|both)|inspect|prior-?artifact|existing (code|repo|hook|target)|grep|survey .* (before|first)/i,
  },
  {
    key: "phase-structure",
    label: "Phase structure (OBSERVE / PLAN / EXECUTE / VERIFY / LEARN ordering)",
    patterns:
      /observe|\bplan phase\b|execute|\bverify phase\b|\blearn phase\b|between (observe|plan|execute|verify)|new phase|a .* phase\b/i,
  },
  {
    key: "scope",
    label: "Scope & altitude (minimal change, avoid over-engineering)",
    patterns: /scope|altitude|minimal|over-?eng|too (broad|wide|much)|narrow/i,
  },
];

interface AlgorithmBucket {
  key: string;
  label: string;
  count: number;
  avgSentiment: number;
  projects: number;
  quotes: string[];
}

export interface AlgorithmSynthesis {
  total: number;
  since: string | null;
  buckets: AlgorithmBucket[];
  /** Count of Q2s the keyword pre-sort matched no bucket for. */
  unbucketed: number;
  /** Full deduped text of every unbucketed Q2 — the safety net, never just a count. */
  unbucketedQuotes: string[];
}

function projectOf(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? "";
}

/**
 * Cluster Q2 reflections into candidate algorithm-improvement areas. A Q2 may
 * land in multiple buckets (ideas often span areas); `unbucketed` counts Q2s
 * that matched none, so blind spots in the bucket set stay visible.
 */
export function synthesizeAlgorithm(since?: Date): AlgorithmSynthesis {
  const all = readReflections(paths.reflectionsFile());
  const filtered = since ? all.filter((r) => r.ts && new Date(r.ts) >= since) : all;
  const q2s = filtered.filter((r) => r.q2.trim());

  const acc = new Map<
    string,
    { sentiments: number[]; projects: Set<string>; quotes: string[] }
  >();
  for (const b of BUCKETS) {
    acc.set(b.key, { sentiments: [], projects: new Set(), quotes: [] });
  }

  let unbucketed = 0;
  const unbucketedQuotes: string[] = [];
  for (const r of q2s) {
    const matched = BUCKETS.filter((b) => b.patterns.test(r.q2));
    if (matched.length === 0) {
      unbucketed += 1;
      unbucketedQuotes.push(r.q2.trim());
      continue;
    }
    for (const b of matched) {
      const a = acc.get(b.key);
      if (!a) continue;
      a.sentiments.push(r.sentiment);
      if (r.cwd) a.projects.add(projectOf(r.cwd));
      a.quotes.push(r.q2.trim());
    }
  }

  const buckets: AlgorithmBucket[] = BUCKETS.map((b) => {
    const a = acc.get(b.key);
    const sentiments = a?.sentiments ?? [];
    const avg = sentiments.length
      ? sentiments.reduce((s, n) => s + n, 0) / sentiments.length
      : 0;
    // Full deduped membership, longest (most specific) first. Not capped here —
    // --json carries every member so nothing is lost; the human report caps the
    // display per bucket. Zero-loss is the contract.
    const quotes = [...new Set(a?.quotes ?? [])].sort((x, y) => y.length - x.length);
    return {
      key: b.key,
      label: b.label,
      count: sentiments.length,
      avgSentiment: Math.round(avg * 10) / 10,
      projects: a?.projects.size ?? 0,
      quotes,
    };
  })
    .filter((b) => b.count > 0)
    .sort((x, y) => y.count - x.count);

  return {
    total: q2s.length,
    since: since ? since.toISOString() : null,
    buckets,
    unbucketed,
    unbucketedQuotes: [...new Set(unbucketedQuotes)],
  };
}

/** Render the synthesis as a markdown candidate-changes report. */
export function formatAlgorithmReport(s: AlgorithmSynthesis): string {
  const sinceLabel = s.since ? ` since ${s.since.slice(0, 10)}` : " (all time)";
  const lines = [
    "# Algorithm Update — Candidate Changes",
    `Source: ${s.total} Q2 reflections${sinceLabel}`,
    "",
    "> The buckets below are a keyword pre-sort hint (biased to current wording).",
    "> Cluster semantically yourself — and read the Unbucketed section in full,",
    "> since that is where wording the heuristic missed lands.",
    "",
    "## Pre-sorted candidate areas",
  ];
  s.buckets.forEach((b, i) => {
    lines.push(
      `### ${i + 1}. ${b.label}`,
      `${b.count} reflections · avg sentiment ${b.avgSentiment}/10 · ${b.projects} project(s)`,
      ""
    );
    for (const q of b.quotes.slice(0, 5)) lines.push(`- ${q}`);
    if (b.quotes.length > 5) lines.push(`- _…+${b.quotes.length - 5} more (see --json)_`);
    lines.push("");
  });
  lines.push(
    `## Unbucketed — ${s.unbucketed} Q2s the pre-sort missed (cluster these by hand)`,
    ""
  );
  for (const q of s.unbucketedQuotes) lines.push(`- ${q}`);
  return lines.join("\n");
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      since: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const since = values.since ? new Date(values.since) : undefined;
  const result = synthesizeAlgorithm(since);
  console.log(
    values.json ? JSON.stringify(result, null, 2) : formatAlgorithmReport(result)
  );
}

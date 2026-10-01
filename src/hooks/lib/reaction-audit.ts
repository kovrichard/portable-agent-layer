/**
 * Reaction-rule audit cadence and comparison. Maintainer-only: the nudge fires
 * solely in a PAL checkout (see algorithm-review.ts), and the audit never edits
 * the rules, it only reports where a model's reading disagrees with them.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMaintainerEnv } from "./algorithm-review";
import type { Reaction } from "./interaction-reaction";
import { type ReactionSample, readSamples } from "./interaction-samples";
import { paths } from "./paths";

interface AuditMark {
  lastAuditTs: string;
  followUpShare: number;
}

export interface BlindSample {
  id: string;
  text: string;
  replyEnd: string;
}

interface Disagreement extends BlindSample {
  rule: Reaction;
  model: string;
}

export interface AuditComparison {
  compared: number;
  agreed: number;
  disagreements: Disagreement[];
}

const NUDGE_MIN_NEW = 40;
const DRIFT_MIN_NEW = 20;
const DRIFT_MIN_DELTA = 0.15;

function markFile(): string {
  return resolve(paths.state(), "reaction-audit.json");
}

function readAuditMark(): AuditMark | null {
  try {
    const parsed = JSON.parse(readFileSync(markFile(), "utf-8"));
    return typeof parsed.lastAuditTs === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function followUpShare(samples: ReactionSample[]): number {
  if (samples.length === 0) return 0;
  return samples.filter((s) => s.reaction === "follow-up").length / samples.length;
}

export function unauditedSamples(mark = readAuditMark()): ReactionSample[] {
  const samples = readSamples();
  return mark ? samples.filter((s) => s.ts > mark.lastAuditTs) : samples;
}

/** The rule's label stays out, so the model's reading is a second opinion, not a review. */
export function blindSamples(samples: ReactionSample[]): BlindSample[] {
  return samples.map(({ ts, text, replyEnd }) => ({ id: ts, text, replyEnd }));
}

export function compareLabels(
  samples: ReactionSample[],
  modelLabels: Record<string, string>
): AuditComparison {
  const labelled = samples.filter((s) => modelLabels[s.ts]);
  const disagreements = labelled
    .filter((s) => modelLabels[s.ts] !== s.reaction)
    .map((s) => ({
      ...blindSamples([s])[0],
      rule: s.reaction,
      model: modelLabels[s.ts],
    }));
  return {
    compared: labelled.length,
    agreed: labelled.length - disagreements.length,
    disagreements,
  };
}

export function writeAuditMark(now: Date = new Date()): void {
  const mark: AuditMark = {
    lastAuditTs: now.toISOString(),
    followUpShare: followUpShare(readSamples()),
  };
  writeFileSync(markFile(), `${JSON.stringify(mark, null, 2)}\n`);
}

function auditReason(): string | null {
  const mark = readAuditMark();
  const fresh = unauditedSamples(mark);
  if (fresh.length >= NUDGE_MIN_NEW) return `${fresh.length} new labelled messages`;
  if (!mark || fresh.length < DRIFT_MIN_NEW) return null;
  const share = followUpShare(fresh);
  if (Math.abs(share - mark.followUpShare) < DRIFT_MIN_DELTA) return null;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `the follow-up share moved from ${pct(mark.followUpShare)} to ${pct(share)}`;
}

/** Formatted nudge section for the session reminder, or "" when it shouldn't fire. */
export function loadReactionAuditNudge(cwd: string = process.cwd()): string {
  if (!isMaintainerEnv(cwd)) return "";
  const reason = auditReason();
  if (!reason) return "";
  return [
    "## Reaction Rules Audit Due",
    `🔎 ${reason} since the last audit — run \`/reaction-audit\` to check the reaction rules against them.`,
  ].join("\n");
}

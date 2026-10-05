/**
 * What `pal cli interaction report` says: how the user's turns went, and whether
 * the agent's replies changed while a measured label was in its context.
 */

import type { ClaimRecord } from "../../hooks/lib/claim-log";
import type { TurnEvent } from "../../hooks/lib/interaction";
import { median } from "../../hooks/lib/interaction-mood";
import {
  approvedShare,
  hasEnoughReplies,
  isEvidence,
  reactedReplies,
  type Side,
  type Split,
  splits,
} from "../../hooks/lib/interaction-preferences";
import { approvalIsKnown } from "../../hooks/lib/interaction-reaction";

const LABELS = ["short", "long", "fast", "skimming", "friction"] as const;

interface ReplyUnderMood {
  labels: string[];
  words: number;
  approved: boolean | null;
  corrected: boolean;
  complied?: boolean;
}

interface HintFollowing {
  checked: number;
  followed: number;
}

interface ReplyStats {
  replies: number;
  medianWords: number | null;
  approvedShare: number;
  correctedShare: number;
  followed: HintFollowing;
}

interface AgentCounts {
  turns: number;
  replies: number;
  hints: number;
}

export interface InteractionSummary {
  turns: number;
  sessions: number;
  channels: Record<string, number>;
  agents: Record<string, AgentCounts>;
  reactions: Record<string, number>;
  hints: Record<string, number>;
  unlogged: number;
  readBeforeGoAhead: number;
  usual: ReplyStats;
  byLabel: Record<string, ReplyStats>;
  approvals: Approvals;
  approvalsByChannel: Record<string, Approvals>;
}

interface Approvals {
  reacted: number;
  splits: Split[];
}

function approvals(events: TurnEvent[]): Approvals {
  return { reacted: reactedReplies(events), splits: splits(events) };
}

function tally(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  return counts;
}

function share(replies: ReplyUnderMood[], test: (r: ReplyUnderMood) => boolean): number {
  return replies.length ? replies.filter(test).length / replies.length : 0;
}

function stats(replies: ReplyUnderMood[]): ReplyStats {
  return {
    replies: replies.length,
    medianWords: median(replies.map((r) => r.words)),
    approvedShare: share(
      replies.filter((r) => r.approved !== null),
      (r) => r.approved === true
    ),
    correctedShare: share(replies, (r) => r.corrected),
    followed: {
      checked: replies.filter((r) => r.complied !== undefined).length,
      followed: replies.filter((r) => r.complied === true).length,
    },
  };
}

/** The reply to a turn arrives with the session's next turn, written under that turn's mood. */
function repliesUnderMood(events: TurnEvent[]): ReplyUnderMood[] {
  const lastMood = new Map<string, string | undefined>();
  const replies: ReplyUnderMood[] = [];
  for (const e of events) {
    const mood = lastMood.get(e.session);
    if (e.reply && mood !== undefined)
      replies.push({
        labels: mood ? mood.split(",") : [],
        words: e.reply.words,
        approved: approvalIsKnown(e) ? e.reaction === "approved" : null,
        corrected: e.reaction === "corrected" || e.reaction === "repeated",
        complied: e.complied,
      });
    lastMood.set(e.session, e.mood);
  }
  return replies;
}

function reactionName(e: TurnEvent): string {
  if (e.reaction === "approved" && !approvalIsKnown(e)) return "approved or go-ahead";
  return e.reaction ?? "";
}

/** A turn carries the reply that answered the turn before it, so a filed reply shows up there. */
function byAgent(events: TurnEvent[]): Record<string, AgentCounts> {
  const agents: Record<string, AgentCounts> = {};
  for (const e of events) {
    const agent = e.runtime ?? "unknown";
    const counts = agents[agent] ?? { turns: 0, replies: 0, hints: 0 };
    agents[agent] = counts;
    counts.turns++;
    if (e.reply) counts.replies++;
    if (e.hinted) counts.hints++;
  }
  return agents;
}

export function summarize(events: TurnEvent[]): InteractionSummary {
  const replies = repliesUnderMood(events);
  const hinted = events.filter((e) => e.hinted);
  return {
    turns: events.length,
    sessions: new Set(events.map((e) => e.session)).size,
    channels: tally(events.map((e) => e.channel ?? "unknown")),
    agents: byAgent(events),
    reactions: tally(events.flatMap((e) => (e.reaction ? [reactionName(e)] : []))),
    readBeforeGoAhead: events.filter((e) => e.reaction && !approvalIsKnown(e)).length,
    hints: tally(hinted.map((e) => e.mood || "back to usual")),
    unlogged: events.filter((e) => e.mood === undefined).length,
    usual: stats(replies.filter((r) => r.labels.length === 0)),
    byLabel: Object.fromEntries(
      LABELS.map((label) => [
        label,
        stats(replies.filter((r) => r.labels.includes(label))),
      ])
    ),
    approvals: approvals(events),
    approvalsByChannel: approvalsByChannel(events),
  };
}

function approvalsByChannel(events: TurnEvent[]): Record<string, Approvals> {
  const channels = Map.groupBy(events, (e) => e.channel ?? "unknown");
  return Object.fromEntries(
    [...channels]
      .map(([channel, turns]) => [channel, approvals(turns)] as const)
      .filter(([, a]) => a.reacted > 0)
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function counts(record: Record<string, number>): string {
  const entries = Object.entries(record).sort(([, a], [, b]) => b - a);
  return entries.length ? entries.map(([k, n]) => `${k} ${n}`).join(" · ") : "none";
}

function shares(record: Record<string, number>): string {
  const total = Object.values(record).reduce((a, b) => a + b, 0);
  const entries = Object.entries(record).sort(([, a], [, b]) => b - a);
  return total ? entries.map(([k, n]) => `${k} ${pct(n / total)}`).join(" · ") : "none";
}

function words(s: ReplyStats): string {
  return s.medianWords === null ? "-" : `${Math.round(s.medianWords)}`;
}

function labelLine(label: string, s: ReplyStats, usual: ReplyStats): string {
  if (s.replies === 0) return `  ${label.padEnd(9)} no replies yet`;
  const parts = [
    `  ${label.padEnd(9)} ${s.replies} replies`,
    `median ${words(s)} words (usual ${words(usual)})`,
    `approved ${pct(s.approvedShare)} (usual ${pct(usual.approvedShare)})`,
    `corrected ${pct(s.correctedShare)} (usual ${pct(usual.correctedShare)})`,
  ];
  if (s.followed.checked)
    parts.push(`followed ${s.followed.followed} of ${s.followed.checked}`);
  return parts.join(" · ");
}

const UNBACKED_LISTED = 5;

export function claimCheckLines(records: ClaimRecord[]): string[] {
  if (records.length === 0) return [];
  const unbacked = records.filter((r) => r.verdict === "unbacked");
  const unknown = records.filter((r) => r.verdict === "unknown").length;
  const sentBack = records.filter((r) => r.blocked).length;
  return [
    "",
    `Result and status claims: ${plural(records.length, "reply", "replies")} · ${unbacked.length} with no command behind it · ${sentBack} sent back · ${unknown} unreadable`,
    ...unbacked
      .slice(-UNBACKED_LISTED)
      .flatMap((r) => (r.claims ?? []).map((c) => `  no command: ${c}`)),
  ];
}

function plural(n: number, noun: string, nouns = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : nouns}`;
}

function approvedOf(s: Side): string {
  return `${pct(approvedShare(s))} of ${s.replies}`;
}

function splitLine(split: Split): string {
  const head = `  ${split.shape}:`;
  if (!hasEnoughReplies(split))
    return `${head} too few replies (${split.has.replies} against ${split.lacks.replies})`;
  if (!isEvidence(split))
    return `${head} no real difference (${approvedOf(split.has)} against ${approvedOf(split.lacks)})`;
  return `${head} approved ${approvedOf(split.has)} · ${split.opposite}: ${approvedOf(split.lacks)}`;
}

function approvalLines(title: string, a: Approvals): string[] {
  return [
    "",
    `${title}, from ${plural(a.reacted, "reacted reply", "reacted replies")}:`,
    ...a.splits.map(splitLine),
  ];
}

function allApprovalLines(summary: InteractionSummary): string[] {
  if (summary.approvals.reacted === 0) return [];
  return [
    ...approvalLines("What gets approved", summary.approvals),
    ...Object.entries(summary.approvalsByChannel).flatMap(([channel, a]) =>
      approvalLines(`On ${channel}`, a)
    ),
  ];
}

function agentLines(agents: Record<string, AgentCounts>): string[] {
  return Object.entries(agents)
    .sort(([, a], [, b]) => b.turns - a.turns)
    .map(([agent, c]) =>
      [
        `  ${agent.padEnd(9)} ${plural(c.turns, "turn")}`,
        `${plural(c.replies, "reply", "replies")} filed`,
        `${plural(c.hints, "hint")} sent`,
      ].join(" · ")
    );
}

export function reportLines(summary: InteractionSummary, days: number): string[] {
  const period = days === 1 ? "day" : plural(days, "day");
  if (summary.turns === 0) return [`No measured turns in the last ${period}.`];
  const lines = [
    `Interaction report, last ${period}`,
    `Turns: ${summary.turns} in ${plural(summary.sessions, "session")} · ${counts(summary.channels)}`,
    `Reactions: ${shares(summary.reactions)}`,
    `Hints sent: ${counts(summary.hints)}`,
    "",
    "By agent:",
    ...agentLines(summary.agents),
    "",
    "Replies written while a label was active, against replies while none was:",
    ...LABELS.map((label) => labelLine(label, summary.byLabel[label], summary.usual)),
    ...allApprovalLines(summary),
  ];
  if (summary.unlogged)
    lines.push(
      "",
      `${summary.unlogged} older turns were logged before moods were, and are left out of the comparison.`
    );
  if (summary.readBeforeGoAhead)
    lines.push(
      "",
      `${summary.readBeforeGoAhead} older replies were read before go-ahead was split from approval, and are left out of the approval figures.`
    );
  return lines;
}

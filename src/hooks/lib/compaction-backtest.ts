import {
  compactionInput,
  compactionMarginTokens,
  compactionPoint,
  compactionPredicted,
  IDLE_COMPACT_AFTER_MS,
} from "./compaction-near";
import type { LoggedEvent } from "./events";
import { median } from "./interaction-mood";

const THRESHOLD_SLACK_TOKENS = 8_000;
const MINUTE_MS = 60_000;
const IDLE_LABEL_SLACK_MS = 2 * MINUTE_MS;
const IDLE_LABEL_AFTER_MS = IDLE_COMPACT_AFTER_MS - IDLE_LABEL_SLACK_MS;

export interface WindowEntry {
  tokens: number;
  until: number | null;
}

export interface BacktestLabels {
  threshold: number;
  idle: number;
  unexplained: number;
}

export interface BacktestRow {
  margin: number;
  warned: number;
  missed: number;
  falseAlarms: number;
  medianLeadMinutes: number | null;
  medianLeadTokens: number | null;
}

type WindowAt = (session: string, ts: number, model: string | null) => number | null;

interface Call {
  ts: number;
  tokens: number;
  model: string | null;
}

interface Ending {
  ts: number;
  trigger: unknown;
  contextTokens: unknown;
  previousCall: Call | null;
}

interface Segment {
  session: string;
  calls: Call[];
  end: Ending | null;
}

type Label = "threshold" | "idle" | "unexplained";

interface SessionItem {
  ts: number;
  kind: "call" | "compaction";
  event: LoggedEvent;
}

const KIND_ORDER = { call: 0, compaction: 1 } as const;

function numberOr0(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function parsesAsTime(ts: unknown): boolean {
  return typeof ts === "string" && !Number.isNaN(Date.parse(ts));
}

function addItem(
  bySession: Map<string, SessionItem[]>,
  event: LoggedEvent,
  kind: SessionItem["kind"]
): void {
  if (typeof event.session !== "string" || !parsesAsTime(event.ts)) return;
  const items = bySession.get(event.session) ?? [];
  items.push({ ts: Date.parse(String(event.ts)), kind, event });
  bySession.set(event.session, items);
}

function isMainThreadCall(call: LoggedEvent): boolean {
  return (
    call.runtime === "claude" && call.sidechain !== true && call.entrypoint !== "sdk-cli"
  );
}

function callContextTokens(call: LoggedEvent): number {
  return (
    numberOr0(call.inputTokens) +
    numberOr0(call.cacheRead) +
    numberOr0(call.cacheWrite5m) +
    numberOr0(call.cacheWrite1h)
  );
}

function segmentsOf(session: string, items: SessionItem[]): Segment[] {
  const sorted = [...items].sort(
    (a, b) => a.ts - b.ts || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  );
  const segments: Segment[] = [];
  let current: Segment = { session, calls: [], end: null };
  let previousCall: Call | null = null;
  for (const item of sorted) {
    if (item.kind === "call") {
      const call: Call = {
        ts: item.ts,
        tokens: callContextTokens(item.event),
        model: typeof item.event.model === "string" ? item.event.model : null,
      };
      current.calls.push(call);
      previousCall = call;
    } else {
      current.end = {
        ts: item.ts,
        trigger: item.event.trigger,
        contextTokens: item.event.contextTokens,
        previousCall,
      };
      segments.push(current);
      current = { session, calls: [], end: null };
    }
  }
  if (current.calls.length > 0) segments.push(current);
  return segments;
}

function sessionSegments(calls: LoggedEvent[], compactions: LoggedEvent[]): Segment[] {
  const bySession = new Map<string, SessionItem[]>();
  for (const call of calls) if (isMainThreadCall(call)) addItem(bySession, call, "call");
  for (const compaction of compactions) {
    if (compaction.runtime === "claude") addItem(bySession, compaction, "compaction");
  }
  return [...bySession].flatMap(([session, items]) => segmentsOf(session, items));
}

function labelOf(segment: Segment, windowAt: WindowAt): Label | null {
  const end = segment.end;
  if (end?.trigger !== "auto") return null;
  const model = end.previousCall?.model ?? null;
  const window = windowAt(segment.session, end.ts, model);
  if (window !== null && typeof end.contextTokens === "number") {
    const point = compactionPoint(compactionInput(model, window));
    if (
      point - THRESHOLD_SLACK_TOKENS <= end.contextTokens &&
      end.contextTokens <= point
    ) {
      return "threshold";
    }
  }
  const previous = end.previousCall;
  if (previous && end.ts - previous.ts >= IDLE_LABEL_AFTER_MS) return "idle";
  return "unexplained";
}

function reaches(
  call: Call,
  session: string,
  margin: number,
  windowAt: WindowAt
): boolean {
  const window = windowAt(session, call.ts, call.model);
  if (window === null) return false;
  const input = compactionInput(call.model, window);
  return compactionPredicted(
    compactionPoint(input) - call.tokens,
    compactionMarginTokens(input, margin)
  );
}

function scoreMargin(
  scored: { segment: Segment; label: Label | null }[],
  margin: number,
  windowAt: WindowAt
): BacktestRow {
  let warned = 0;
  let missed = 0;
  let falseAlarms = 0;
  const leadMinutes: number[] = [];
  const leadTokens: number[] = [];
  for (const { segment, label } of scored) {
    const first = segment.calls.find((call) =>
      reaches(call, segment.session, margin, windowAt)
    );
    const end = segment.end;
    if (end === null) {
      if (first) falseAlarms++;
      continue;
    }
    if (label !== "threshold") continue;
    const last = segment.calls.at(-1);
    if (first && last) {
      warned++;
      leadMinutes.push((end.ts - first.ts) / MINUTE_MS);
      leadTokens.push(last.tokens - first.tokens);
    } else {
      missed++;
    }
  }
  return {
    margin,
    warned,
    missed,
    falseAlarms,
    medianLeadMinutes: median(leadMinutes),
    medianLeadTokens: median(leadTokens),
  };
}

export function backtestCompaction(
  calls: LoggedEvent[],
  compactions: LoggedEvent[],
  margins: number[],
  windowAt: WindowAt
): { labels: BacktestLabels; rows: BacktestRow[] } {
  const scored = sessionSegments(calls, compactions).map((segment) => ({
    segment,
    label: labelOf(segment, windowAt),
  }));
  const labels: BacktestLabels = { threshold: 0, idle: 0, unexplained: 0 };
  for (const { label } of scored) if (label) labels[label]++;
  return {
    labels,
    rows: margins.map((margin) => scoreMargin(scored, margin, windowAt)),
  };
}

function scheduledWindow(schedule: WindowEntry[], ts: number): number | null {
  const entry = schedule.find((e) => e.until === null || ts < e.until);
  return entry ? entry.tokens : null;
}

function nearWindowOf(
  nearBySession: Map<string, { ts: number; tokens: number }[]>,
  session: string,
  ts: number
): number | null {
  let latest: number | null = null;
  for (const entry of nearBySession.get(session) ?? []) {
    if (entry.ts <= ts) latest = entry.tokens;
  }
  return latest;
}

export function windowResolver(
  nearEvents: LoggedEvent[],
  schedule: WindowEntry[],
  current: (model: string | null) => number | null
): WindowAt {
  const nearBySession = new Map<string, { ts: number; tokens: number }[]>();
  for (const event of nearEvents) {
    if (
      event.trigger !== "threshold" ||
      typeof event.windowTokens !== "number" ||
      typeof event.session !== "string" ||
      !parsesAsTime(event.ts)
    ) {
      continue;
    }
    const entries = nearBySession.get(event.session) ?? [];
    entries.push({ ts: Date.parse(String(event.ts)), tokens: event.windowTokens });
    nearBySession.set(event.session, entries);
  }
  for (const entries of nearBySession.values()) entries.sort((a, b) => a.ts - b.ts);
  const currentByModel = new Map<string | null, number | null>();
  const currentWindow = (model: string | null): number | null => {
    if (!currentByModel.has(model)) currentByModel.set(model, current(model));
    return currentByModel.get(model) ?? null;
  };
  return (session, ts, model) =>
    nearWindowOf(nearBySession, session, ts) ??
    scheduledWindow(schedule, ts) ??
    currentWindow(model);
}

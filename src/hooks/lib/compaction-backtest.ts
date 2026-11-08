import { compactionPredicted } from "./compaction-near";
import type { LoggedEvent } from "./events";
import { median } from "./interaction-mood";

export interface BacktestRow {
  threshold: number;
  warned: number;
  missed: number;
  falseAlarms: number;
  medianLeadMinutes: number | null;
  medianLeadTokens: number | null;
}

interface SegmentCall {
  ts: number;
  tokens: number;
}

interface SegmentEnd {
  ts: number;
  auto: boolean;
}

interface Segment {
  calls: SegmentCall[];
  end: SegmentEnd | null;
}

interface SessionItem {
  ts: number;
  kind: "call" | "compaction";
  event: LoggedEvent;
}

const KIND_ORDER = { call: 0, compaction: 1 } as const;
const MINUTE_MS = 60_000;

function numberOr0(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function callContextTokens(call: LoggedEvent): number {
  return (
    numberOr0(call.inputTokens) +
    numberOr0(call.cacheRead) +
    numberOr0(call.cacheWrite5m) +
    numberOr0(call.cacheWrite1h)
  );
}

function parsesAsTime(ts: unknown): boolean {
  return typeof ts === "string" && !Number.isNaN(Date.parse(ts));
}

function isMainThreadCall(call: LoggedEvent): boolean {
  return (
    call.runtime === "claude" && call.sidechain !== true && call.entrypoint !== "sdk-cli"
  );
}

function addItem(
  bySession: Map<string, SessionItem[]>,
  event: LoggedEvent,
  kind: SessionItem["kind"]
): void {
  const session = event.session;
  if (typeof session !== "string" || !parsesAsTime(event.ts)) return;
  const items = bySession.get(session) ?? [];
  items.push({ ts: Date.parse(String(event.ts)), kind, event });
  bySession.set(session, items);
}

function segmentsOf(items: SessionItem[]): Segment[] {
  const ordered = [...items].sort(
    (a, b) => a.ts - b.ts || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  );
  const segments: Segment[] = [];
  let calls: SegmentCall[] = [];
  for (const item of ordered) {
    if (item.kind === "call") {
      calls.push({ ts: item.ts, tokens: callContextTokens(item.event) });
    } else {
      segments.push({ calls, end: { ts: item.ts, auto: item.event.trigger === "auto" } });
      calls = [];
    }
  }
  if (calls.length > 0) segments.push({ calls, end: null });
  return segments;
}

function sessionSegments(calls: LoggedEvent[], compactions: LoggedEvent[]): Segment[] {
  const bySession = new Map<string, SessionItem[]>();
  for (const call of calls.filter(isMainThreadCall)) addItem(bySession, call, "call");
  for (const compaction of compactions.filter((e) => e.runtime === "claude")) {
    addItem(bySession, compaction, "compaction");
  }
  return [...bySession.values()].flatMap(segmentsOf);
}

function scoreSegments(segments: Segment[], threshold: number): BacktestRow {
  let warned = 0;
  let missed = 0;
  let falseAlarms = 0;
  const minuteLeads: number[] = [];
  const tokenLeads: number[] = [];
  for (const segment of segments) {
    const first = segment.calls.find((call) =>
      compactionPredicted(call.tokens, threshold)
    );
    if (segment.end === null) {
      if (first) falseAlarms++;
    } else if (segment.end.auto) {
      const last = segment.calls.at(-1);
      if (first && last) {
        warned++;
        minuteLeads.push((segment.end.ts - first.ts) / MINUTE_MS);
        tokenLeads.push(last.tokens - first.tokens);
      } else {
        missed++;
      }
    }
  }
  return {
    threshold,
    warned,
    missed,
    falseAlarms,
    medianLeadMinutes: median(minuteLeads),
    medianLeadTokens: median(tokenLeads),
  };
}

export function backtestRows(
  calls: LoggedEvent[],
  compactions: LoggedEvent[],
  thresholds: number[]
): BacktestRow[] {
  const segments = sessionSegments(calls, compactions);
  return thresholds.map((threshold) => scoreSegments(segments, threshold));
}

/**
 * ALGORITHM runs in shadow mode: the stop records each run's turns and verdict,
 * a reflection records itself, and nothing is warned, injected or blocked.
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent, eventsSince, logQuietly } from "../../bronze/events";
import { paths } from "../../core/paths";
import { sessionDir } from "../../core/session-dir";
import { eventLogEnabled } from "../../core/settings";
import { algorithmTurnFacts, phasesIn } from "./algorithm-run-facts";
import {
  cachedState,
  type PlannedEvent,
  type RunEvent,
  type RunState,
  replayRuns,
  stopEvents,
} from "./algorithm-run-replay";
import { lastTurnIdOf } from "./interaction";
import { progressSession } from "./progress-session";
import { activePath, readTree, scopeOf } from "./progress-tree";
import { extractContent, type Message } from "./transcript";

export type TurnSource = "transcript" | "final-reply";

const REBUILD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function algorithmRunsCacheFile(): string {
  return resolve(paths.cache(), "algorithm-runs.json");
}

function readCache(): RunState | null {
  try {
    const cached = JSON.parse(String(readFileSync(algorithmRunsCacheFile())));

    return cached?.open && cached.pending ? cached : null;
  } catch {
    return null;
  }
}

function writeCache(state: RunState, now: Date): void {
  const file = algorithmRunsCacheFile();
  const partial = `${file}.${process.pid}.tmp`;
  writeFileSync(partial, `${JSON.stringify(cachedState(state, now))}\n`);
  renameSync(partial, file);
}

function rebuiltRunState(now: Date): RunState {
  const since = new Date(now.getTime() - REBUILD_DAYS * DAY_MS);
  const events = eventsSince("algorithm_run", since) as unknown as RunEvent[];

  return cachedState(replayRuns(events), now);
}

/** The cached state, rebuilt from the event log and written back when the file is missing. */
export function loadRunState(now: Date = new Date()): RunState {
  const cached = readCache();
  if (cached) return cached;
  const rebuilt = rebuiltRunState(now);
  writeCache(rebuilt, now);

  return rebuilt;
}

function activeNodeOf(session: string): string | null {
  const tree = readTree(scopeOf(sessionDir()), undefined, progressSession(session));

  return activePath(tree).at(-1)?.id ?? null;
}

function appendRunEvents(
  planned: PlannedEvent[],
  session: string,
  now: Date
): RunEvent[] {
  const ts = now.toISOString();

  return planned.flatMap(({ id, fields }) => {
    const appended = appendEvent("algorithm_run", fields, { id, ts, session });

    return appended ? [{ ...fields, id: appended, ts } as RunEvent] : [];
  });
}

function recordRunEvents(
  planned: PlannedEvent[],
  state: RunState,
  session: string,
  now: Date
): void {
  const appended = appendRunEvents(planned, session, now);
  writeCache(replayRuns(appended, state), now);
}

/** The assistant texts after the turn's prompt, in order. */
export function turnTexts(messages: Message[]): string[] {
  const prompt = messages.findLastIndex((m) => m.role === "user");

  return messages
    .slice(prompt + 1)
    .filter((m) => m.role === "assistant")
    .map(extractContent);
}

export function recordAlgorithmTurn(
  session: string,
  texts: string[],
  source: TurnSource,
  now: Date = new Date()
): void {
  if (!eventLogEnabled()) return;
  const facts = algorithmTurnFacts(texts);
  const turn = lastTurnIdOf(session);
  if (!facts && !turn) return;
  const state = loadRunState(now);
  const reflected = Object.hasOwn(state.pending, String(turn));
  if (!facts && !reflected) return;
  const node = activeNodeOf(session);
  const planned = stopEvents({
    facts,
    phases: phasesIn(texts),
    node,
    turn,
    reflected,
    open: node ? state.open[node] : undefined,
    newRun: crypto.randomUUID(),
    source,
  });
  recordRunEvents(planned, state, session, now);
}

export function recordAlgorithmTurnQuietly(
  session: string | undefined,
  texts: string[],
  source: TurnSource
): void {
  if (!session) return;
  logQuietly("algorithm_run", () => recordAlgorithmTurn(session, texts, source));
}

export function recordAlgorithmReflection(
  session: string | undefined = progressSession(),
  now: Date = new Date()
): void {
  if (!session || !eventLogEnabled()) return;
  const turn = lastTurnIdOf(session);
  if (!turn) return;
  const reflected: PlannedEvent = {
    fields: { change: "reflected", node: activeNodeOf(session), turn, mode: "shadow" },
  };
  recordRunEvents([reflected], loadRunState(now), session, now);
}

export function recordAlgorithmReflectionQuietly(): void {
  logQuietly("algorithm_run", () => recordAlgorithmReflection());
}

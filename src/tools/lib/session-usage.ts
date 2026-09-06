/**
 * What a finished Claude Code session cost, read back off its transcript.
 *
 * The `pal` wrapper spawns the tool around this after the agent exits, so none
 * of it was reachable from a test: not the search for the session's file, not
 * the token arithmetic, not the formatting.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { costOfUsage } from "../../hooks/lib/models";
import { cacheWritesOf, type TranscriptUsage } from "./transcript-usage";

export interface SessionUsage {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  cost: number;
  calls: number;
  models: Set<string>;
  durationMs: number;
}

export interface SessionFile {
  filepath: string;
  project: string;
}

export function claudeProjectsDir(): string {
  return resolve(homedir(), ".claude", "projects");
}

function projectDirsIn(claudeDir: string) {
  return readdirSync(claudeDir, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory()
  );
}

function projectNameOf(dirName: string): string {
  return dirName.split("-").pop() ?? dirName;
}

/**
 * The most recently written transcript, for when no file is named for the
 * session. Claude Code renames a session's file when it is resumed, so the id
 * on the command line does not always still exist as a filename.
 */
function mostRecentTranscript(claudeDir: string): SessionFile | null {
  let latest: { file: SessionFile; mtime: number } | null = null;

  for (const dir of projectDirsIn(claudeDir)) {
    const projPath = resolve(claudeDir, dir.name);
    let files: string[];
    try {
      files = readdirSync(projPath).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const name of files) {
      const filepath = resolve(projPath, name);
      try {
        const mtime = Bun.file(filepath).lastModified;
        if (!latest || mtime > latest.mtime) {
          latest = { file: { filepath, project: projectNameOf(dir.name) }, mtime };
        }
      } catch {}
    }
  }

  return latest?.file ?? null;
}

export function findSessionFile(
  sessionId: string,
  claudeDir: string
): SessionFile | null {
  if (!existsSync(claudeDir)) return null;

  for (const dir of projectDirsIn(claudeDir)) {
    const filepath = resolve(claudeDir, dir.name, `${sessionId}.jsonl`);
    if (existsSync(filepath)) {
      return { filepath, project: projectNameOf(dir.name) };
    }
  }

  return mostRecentTranscript(claudeDir);
}

interface TranscriptLine {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  message?: { model?: string; usage?: TranscriptUsage };
}

function emptyUsage(): SessionUsage {
  return {
    input: 0,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    cost: 0,
    calls: 0,
    models: new Set(),
    durationMs: 0,
  };
}

export function accumulateUsage(transcript: string, sessionId: string): SessionUsage {
  const total = emptyUsage();
  let firstTs = "";
  let lastTs = "";

  for (const line of transcript.split("\n")) {
    if (!line) continue;

    let entry: TranscriptLine;
    try {
      entry = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }

    if (entry.sessionId !== sessionId) continue;

    if (entry.timestamp) {
      if (!firstTs) firstTs = entry.timestamp;
      lastTs = entry.timestamp;
    }

    if (entry.type !== "assistant") continue;
    const usage = entry.message?.usage;
    const model = entry.message?.model;
    if (!usage || !model) continue;

    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const { cacheWrite5m, cacheWrite1h } = cacheWritesOf(usage);

    total.cost += costOfUsage(model, {
      input,
      output,
      cacheWrite5m,
      cacheWrite1h,
      cacheRead,
    });
    total.input += input;
    total.output += output;
    total.cacheWrite5m += cacheWrite5m;
    total.cacheWrite1h += cacheWrite1h;
    total.cacheRead += cacheRead;
    total.calls++;
    total.models.add(model);
  }

  if (firstTs && lastTs) {
    total.durationMs = new Date(lastTs).getTime() - new Date(firstTs).getTime();
  }

  return total;
}

function parseSession(filepath: string, sessionId: string): SessionUsage {
  return accumulateUsage(readFileSync(filepath, "utf-8"), sessionId);
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Two decimals reads as money; a sub-dollar session needs four to say anything. */
export function fmtCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function fmtDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export function totalTokens(usage: SessionUsage): number {
  return (
    usage.input + usage.output + usage.cacheWrite5m + usage.cacheWrite1h + usage.cacheRead
  );
}

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";

export function summaryLine(project: string, usage: SessionUsage): string {
  const models = [...usage.models].map((m) => m.replace("claude-", "")).join(", ");
  return `\n${DIM}Session: ${project} · ${models} · ${fmtDuration(usage.durationMs)} · ${fmtTokens(totalTokens(usage))} tokens · ${usage.calls} calls · ${CYAN}${fmtCost(usage.cost)}${RESET}`;
}

/** Nothing to say when the session was not found, or made no model calls at all. */
export function sessionSummary(sessionId: string, claudeDir: string): string | null {
  if (!sessionId) return null;
  const file = findSessionFile(sessionId, claudeDir);
  if (!file) return null;
  const usage = parseSession(file.filepath, sessionId);
  return usage.calls === 0 ? null : summaryLine(file.project, usage);
}

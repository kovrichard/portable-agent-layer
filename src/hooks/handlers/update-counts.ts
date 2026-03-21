/**
 * Stop handler: writes fresh counts to memory/state/counts.json
 * so the session-start greeting can read a single file instead of
 * scanning directories and JSONL files.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assets, ensureDir, paths } from "../lib/paths";

interface TokenSummary {
  input: number;
  output: number;
}

interface TokenUsage {
  today: TokenSummary;
  week: TokenSummary;
  month: TokenSummary;
  total: TokenSummary;
}

interface Counts {
  signals: number;
  telos: number;
  skills: number;
  sessions: number;
  tokens: TokenUsage;
  updatedAt: string;
}

function countJsonlLines(filepath: string): number {
  try {
    if (!existsSync(filepath)) return 0;
    const content = readFileSync(filepath, "utf-8").trim();
    return content ? content.split("\n").length : 0;
  } catch {
    return 0;
  }
}

function countMdFiles(dir: string): number {
  try {
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

function getTokenUsage(): TokenUsage {
  const today: TokenSummary = { input: 0, output: 0 };
  const week: TokenSummary = { input: 0, output: 0 };
  const month: TokenSummary = { input: 0, output: 0 };
  const total: TokenSummary = { input: 0, output: 0 };

  const filepath = resolve(paths.signals(), "token-usage.jsonl");
  if (!existsSync(filepath)) return { today, week, month, total };

  try {
    const content = readFileSync(filepath, "utf-8").trim();
    if (!content) return { today, week, month, total };

    const now = new Date();
    const todayPrefix = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    for (const line of content.split("\n")) {
      try {
        const entry = JSON.parse(line) as {
          ts?: string;
          inputTokens?: number;
          outputTokens?: number;
        };
        const input = entry.inputTokens ?? 0;
        const output = entry.outputTokens ?? 0;
        const ts = entry.ts ?? "";

        total.input += input;
        total.output += output;
        if (ts >= monthAgo) {
          month.input += input;
          month.output += output;
        }
        if (ts >= weekAgo) {
          week.input += input;
          week.output += output;
        }
        if (ts.startsWith(todayPrefix)) {
          today.input += input;
          today.output += output;
        }
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* file read error */
  }

  return { today, week, month, total };
}

function getCounts(): Counts {
  const signalsDir = paths.signals();
  const signals = countJsonlLines(resolve(signalsDir, "ratings.jsonl"));

  const telos = countMdFiles(paths.telos());

  // Count skills in the PAI skills dir
  let skills = 0;
  const skillsDir = assets.skills();
  try {
    if (existsSync(skillsDir)) {
      skills = readdirSync(skillsDir, { withFileTypes: true }).filter((e) =>
        e.isDirectory()
      ).length;
    }
  } catch {
    /* skip */
  }

  // Count named sessions
  let sessions = 0;
  try {
    const namesPath = resolve(paths.state(), "session-names.json");
    if (existsSync(namesPath)) {
      sessions = Object.keys(JSON.parse(readFileSync(namesPath, "utf-8"))).length;
    }
  } catch {
    /* skip */
  }

  const tokens = getTokenUsage();

  return {
    signals,
    telos,
    skills,
    sessions,
    tokens,
    updatedAt: new Date().toISOString(),
  };
}

export async function updateCounts(): Promise<void> {
  const counts = getCounts();
  const countsPath = resolve(ensureDir(paths.state()), "counts.json");
  writeFileSync(countsPath, JSON.stringify(counts, null, 2), "utf-8");
}

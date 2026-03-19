/**
 * Stop handler: writes fresh counts to memory/state/counts.json
 * so the session-start greeting can read a single file instead of
 * scanning directories and JSONL files.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "../lib/paths";

interface Counts {
  signals: number;
  telos: number;
  skills: number;
  sessions: number;
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

function getCounts(): Counts {
  const signalsDir = paths.signals();
  const signals = countJsonlLines(resolve(signalsDir, "ratings.jsonl"));

  const telos = countMdFiles(paths.telos());

  // Count skills in the PAI skills dir
  let skills = 0;
  const skillsDir = paths.skills();
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

  return {
    signals,
    telos,
    skills,
    sessions,
    updatedAt: new Date().toISOString(),
  };
}

export async function updateCounts(): Promise<void> {
  const counts = getCounts();
  const countsPath = resolve(ensureDir(paths.state()), "counts.json");
  writeFileSync(countsPath, JSON.stringify(counts, null, 2), "utf-8");
}

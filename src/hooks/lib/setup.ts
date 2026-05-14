/**
 * Setup state management for PAL first-run wizard.
 *
 * State lives in memory/state/setup.json. Each step maps to a TELOS file.
 * The AI is instructed to mark steps done after writing each file.
 */

import { existsSync, readFileSync } from "node:fs";

interface SetupStep {
  done: boolean;
  file: string;
  question: string;
  hint: string;
}

/** Ordered setup steps — defines the wizard flow */
export const SETUP_STEPS: Record<string, Omit<SetupStep, "done">> = {
  mission: {
    file: "telos/MISSION.md",
    question:
      "What do you do? What's your role and core purpose? (~/.pal/telos/MISSION.md)",
    hint: "e.g. Senior software engineer building developer tooling at Acme Corp",
  },
  goals: {
    file: "telos/GOALS.md",
    question:
      "What are your current goals? (short-term, medium-term, long-term) (~/.pal/telos/GOALS.md)",
    hint: "e.g. Ship v2 by Q3, learn Rust, get promoted to staff engineer",
  },
  beliefs: {
    file: "telos/BELIEFS.md",
    question: "What principles or values guide your work? (~/.pal/telos/BELIEFS.md)",
    hint: "e.g. Simple code > clever code, ship early and iterate, always write tests",
  },
  challenges: {
    file: "telos/CHALLENGES.md",
    question: "What are your biggest current challenges? (~/.pal/telos/CHALLENGES.md)",
    hint: "e.g. Context switching between projects, unclear requirements, work-life balance",
  },
};

export const STEP_ORDER = Object.keys(SETUP_STEPS);

/** Check if a TELOS file has real content (not just template scaffolding) */
export function hasRealContent(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const content = readFileSync(filePath, "utf-8").trim();
    return content.split("\n").some((l) => {
      if (!l.trim()) return false;
      if (l.startsWith("#")) return false;
      if (l.startsWith("<!--") || l.startsWith("-->")) return false;
      if (/^\s*-\s*$/.test(l)) return false;
      return true; // includes table rows (| ... |) — counts as real content
    });
  } catch {
    return false;
  }
}

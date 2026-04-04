/**
 * Setup state management for PAL first-run wizard.
 *
 * State lives in memory/state/setup.json. Each step maps to a TELOS file.
 * The AI is instructed to mark steps done after writing each file.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, palHome, paths } from "./paths";

export interface SetupStep {
  done: boolean;
  file: string;
  question: string;
  hint: string;
}

export interface SetupState {
  version: number;
  completed: boolean;
  steps: Record<string, SetupStep>;
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
  projects: {
    file: "telos/PROJECTS.md",
    question: "What projects are you currently working on? (~/.pal/telos/PROJECTS.md)",
    hint: "e.g. PAL (active, high priority), personal blog (paused), side SaaS (early stage)",
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

function setupPath(): string {
  return resolve(ensureDir(paths.state()), "setup.json");
}

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

/** Create initial setup state, auto-detecting already-populated TELOS files */
export function createInitialState(): SetupState {
  const steps: Record<string, SetupStep> = {};
  for (const [key, def] of Object.entries(SETUP_STEPS)) {
    const populated = hasRealContent(resolve(palHome(), def.file));
    steps[key] = { done: populated, ...def };
  }
  const allDone = Object.values(steps).every((s) => s.done);
  return { version: 1, completed: allDone, steps };
}

/** Read setup state, or return null if no setup.json exists */
export function readSetupState(): SetupState | null {
  const p = setupPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

/** Write setup state to disk */
export function writeSetupState(state: SetupState): void {
  writeFileSync(setupPath(), `${JSON.stringify(state, null, 2)}\n`);
}

/** Seed setup.json if it doesn't exist yet. Returns the state. */
export function ensureSetupState(): SetupState {
  const existing = readSetupState();
  if (existing) return existing;
  const fresh = createInitialState();
  writeSetupState(fresh);
  return fresh;
}

/** Get the list of remaining (not done) step keys, in order */
export function remainingSteps(state: SetupState): string[] {
  return STEP_ORDER.filter((k) => !state.steps[k]?.done);
}

/** Check if setup is fully completed */
export function isSetupComplete(state: SetupState): boolean {
  return state.completed;
}

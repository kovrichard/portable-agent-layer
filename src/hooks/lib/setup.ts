/**
 * Setup state management for PAI first-run wizard.
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
const SETUP_STEPS: Record<string, Omit<SetupStep, "done">> = {
  mission: {
    file: "telos/MISSION.md",
    question: "What's your name and what do you do?",
    hint: "Write their name, role, and core purpose to telos/MISSION.md",
  },
  ai_name: {
    file: "telos/IDENTITY.md",
    question:
      "What would you like to call your AI? (Pick a name — this is how I'll identify myself.)",
    hint: "Write the chosen AI name and identity to telos/IDENTITY.md with fields: name, fullName (name — Personal AI), displayName (UPPERCASED)",
  },
  catchphrase: {
    file: "telos/IDENTITY.md",
    question:
      'What should your AI\'s startup catchphrase be? (e.g. "{name} here, ready to go" — {name} gets replaced with the AI name.)',
    hint: "Append the catchphrase to telos/IDENTITY.md under a ## Catchphrase heading. Support {name} as a placeholder.",
  },
  goals: {
    file: "telos/GOALS.md",
    question: "What are your current goals? (short-term, medium-term, long-term)",
    hint: "Write goals organized by timeframe to telos/GOALS.md",
  },
  projects: {
    file: "telos/PROJECTS.md",
    question: "What projects are you currently working on?",
    hint: "Write to telos/PROJECTS.md using table format: | Project | Status | Priority | Notes |",
  },
  beliefs: {
    file: "telos/BELIEFS.md",
    question: "What principles or values guide your work?",
    hint: "Write their values and principles to telos/BELIEFS.md",
  },
  challenges: {
    file: "telos/CHALLENGES.md",
    question: "What are your biggest current challenges?",
    hint: "Write their challenges and obstacles to telos/CHALLENGES.md",
  },
};

export const STEP_ORDER = Object.keys(SETUP_STEPS);

function setupPath(): string {
  return resolve(ensureDir(paths.state()), "setup.json");
}

/** Check if a TELOS file has real content (not just template scaffolding) */
function hasRealContent(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const content = readFileSync(filePath, "utf-8").trim();
    return content
      .split("\n")
      .some(
        (l) =>
          !l.startsWith("#") &&
          !l.startsWith("<!--") &&
          !l.startsWith("-->") &&
          l.trim() &&
          !/^\s*-\s*$/.test(l) &&
          !/^\s*\|/.test(l)
      );
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

/**
 * Build the system-prompt instructions for the current setup state.
 * Returns null if setup is already complete.
 */
export function buildSetupPrompt(state: SetupState): string | null {
  if (state.completed) return null;

  const remaining = remainingSteps(state);
  if (remaining.length === 0) return null;

  const completedSteps = STEP_ORDER.filter((k) => state.steps[k]?.done);
  const totalSteps = STEP_ORDER.length;

  const lines: string[] = [
    "## IMPORTANT: PAI First-Run Setup Required",
    "",
    "TELOS files are empty — this user has not been set up yet.",
    "You MUST start the setup process immediately, regardless of what the user says.",
    "Greet them, explain that PAI needs to learn about them to personalize future sessions,",
    "and ask the first remaining question below. Do NOT wait for the user to ask about setup.",
    "",
  ];

  if (completedSteps.length > 0) {
    lines.push(
      `Setup in progress — ${completedSteps.length}/${totalSteps} steps complete. Continue from the next remaining step.`,
      ""
    );
  }

  lines.push("### Steps to complete (ask one at a time):", "");

  for (const key of remaining) {
    const step = state.steps[key];
    lines.push(`- **${key}** — Ask: "${step.question}" → ${step.hint}`);
  }

  lines.push(
    "",
    "### After each answer:",
    "1. Write the user's answer to the corresponding TELOS file.",
    `2. Read \`memory/state/setup.json\`, set \`steps.<key>.done = true\`, and write it back.`,
    "3. Ask the next remaining question.",
    "",
    `When all steps are done (or the user wants to skip), set \`completed: true\` in setup.json.`,
    "",
    "Keep it conversational and natural. If the user wants to skip a step, mark it done and move on."
  );

  return lines.join("\n");
}

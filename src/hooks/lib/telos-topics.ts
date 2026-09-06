/**
 * The TELOS topics, and the one rule for whether a topic has been answered.
 *
 * Install does not ask these questions any more — the onboarding skill does,
 * whenever the user is ready to answer them. Both that skill and the doctor
 * read the answer from here through `pal cli telos`, so the prose in the skill
 * cannot drift away from the code that decides.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { palHome } from "./paths";

interface TelosTopic {
  key: string;
  file: string;
  /** Interviewed first, and the only ones the doctor reports on. */
  priority: boolean;
}

const TELOS_TOPICS: TelosTopic[] = [
  { key: "mission", file: "telos/MISSION.md", priority: true },
  { key: "goals", file: "telos/GOALS.md", priority: true },
  { key: "challenges", file: "telos/CHALLENGES.md", priority: true },
  { key: "strategies", file: "telos/STRATEGIES.md", priority: true },
  { key: "beliefs", file: "telos/BELIEFS.md", priority: true },
  { key: "models", file: "telos/MODELS.md", priority: false },
  { key: "narratives", file: "telos/NARRATIVES.md", priority: false },
  { key: "learned", file: "telos/LEARNED.md", priority: false },
  { key: "ideas", file: "telos/IDEAS.md", priority: false },
];

/** A shipped scaffold is headings, comments, rules and empty bullets — nothing said. */
function isScaffolding(line: string): boolean {
  const l = line.trim();
  if (!l) return true;
  if (l.startsWith("#")) return true;
  if (l.startsWith("<!--") || l.startsWith("-->")) return true;
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(l)) return true;
  return /^[-*+]$/.test(l);
}

/**
 * Anything the scaffold did not put there counts, table rows included.
 * @lintignore exercised directly by test/telos-topics.test.ts
 */
export function hasRealContent(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    return readFileSync(filePath, "utf-8")
      .split("\n")
      .some((line) => !isScaffolding(line));
  } catch {
    return false;
  }
}

export interface TopicStatus extends TelosTopic {
  path: string;
  answered: boolean;
}

export function telosStatus(home: string = palHome()): TopicStatus[] {
  return TELOS_TOPICS.map((topic) => {
    const path = resolve(home, topic.file);
    return { ...topic, path, answered: hasRealContent(path) };
  });
}

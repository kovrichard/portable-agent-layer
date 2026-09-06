/**
 * The user's stated goals, read as ranked items rather than prose.
 *
 * A goal belongs on the morning screen next to the projects — "find clients"
 * outranks every repository and is not one. Parsing is deliberately deterministic:
 * the page must render without a model call, so a date is found by reading, not
 * by asking.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { palHome } from "./paths";

export interface TelosGoal {
  id: string;
  title: string;
  text: string;
  /** Horizon heading the entry sat under, when GOALS.md uses them. */
  horizon: string | null;
  /** First date the entry names, as an ISO day. */
  due: string | null;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const ISO_DAY = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const MONTH_YEAR = new RegExp(String.raw`\b(${MONTHS.join("|")})\s+(\d{4})\b`, "i");
const QUARTER = /\bQ([1-4])\s*,?\s*(\d{4})\b/i;

function endOfMonth(year: number, monthIndex: number): string {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
}

/** The last day the entry could still be met, which is what urgency measures against. */
export function dueFrom(text: string): string | null {
  const iso = ISO_DAY.exec(text);
  if (iso) return iso[0];

  const monthYear = MONTH_YEAR.exec(text);
  if (monthYear) {
    return endOfMonth(Number(monthYear[2]), MONTHS.indexOf(monthYear[1].toLowerCase()));
  }

  const quarter = QUARTER.exec(text);
  if (quarter) return endOfMonth(Number(quarter[2]), Number(quarter[1]) * 3 - 1);

  return null;
}

function firstSentenceOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = new RegExp(/^.*?[.!?](?=\s|$)/).exec(flat);
  return match ? match[0] : flat;
}

function slug(title: string, index: number): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-");
  return base || `goal-${index + 1}`;
}

function isScaffolding(line: string): boolean {
  const l = line.trim();
  return !l || l.startsWith("<!--") || l.startsWith("-->") || /^(-{3,}|_{3,})$/.test(l);
}

/**
 * Bullets are entries when a block has them; otherwise the paragraph is the
 * entry. Both shapes ship — the scaffold offers horizon headings with bullets,
 * and people write prose anyway.
 */
function entriesIn(lines: string[]): string[] {
  const bullets = lines
    .filter((l) => /^\s*[-*+]\s+\S/.test(l))
    .map((l) => l.replace(/^\s*[-*+]\s+/, "").trim());
  if (bullets.length > 0) return bullets;
  const paragraph = lines.join(" ").trim();
  return paragraph ? [paragraph] : [];
}

function goalsFrom(content: string): TelosGoal[] {
  const goals: TelosGoal[] = [];
  let horizon: string | null = null;
  let block: string[] = [];

  const flush = () => {
    for (const text of entriesIn(block)) {
      const title = firstSentenceOf(text);
      goals.push({
        id: slug(title, goals.length),
        title,
        text: text.replace(/\s+/g, " ").trim(),
        horizon,
        due: dueFrom(text),
      });
    }
    block = [];
  };

  for (const line of content.split("\n")) {
    if (line.trim().startsWith("#")) {
      flush();
      const heading = line.replace(/^#+\s*/, "").trim();
      horizon = /^goals$/i.test(heading) ? null : heading;
      continue;
    }
    if (isScaffolding(line)) {
      flush();
      continue;
    }
    block.push(line);
  }
  flush();

  return goals;
}

export function readTelosGoals(home: string = palHome()): TelosGoal[] {
  const path = resolve(home, "telos", "GOALS.md");
  if (!existsSync(path)) return [];
  try {
    return goalsFrom(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

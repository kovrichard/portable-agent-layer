/**
 * Periodic reflection on relationship notes: what recurs, what it says about
 * the user, and which of it has earned a tracked opinion.
 *
 * The tool around this is only ever spawned, so none of the judgement was
 * reachable from a test — not the note grammar, not the similarity grouping
 * that decides two notes are the same observation, not the rule that a note
 * needs a second sighting before it becomes an opinion.
 *
 * The readers take the directory to read and the clock to read it against,
 * which is what makes a fixed corpus at a fixed date assertable.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { addEvidence, createOpinion, findSimilarOpinion } from "../../hooks/lib/opinions";
import { similarity } from "../../hooks/lib/text-similarity";

type Opinion = ReturnType<typeof createOpinion>;

export interface Rating {
  ts: string;
  rating: number;
  context: string;
  source: "explicit" | "implicit";
}

export interface ParsedNote {
  type: "W" | "O" | "Session";
  text: string;
  confidence?: number;
  date: string;
  time: string;
}

export interface OpinionChange {
  statement: string;
  action: "created" | "strengthened";
  oldConfidence?: number;
  newConfidence: number;
}

export interface OpinionSummary {
  text: string;
  occurrences: number;
  avgConfidence: number;
  dates: string[];
}

/** What reflection decided to do, kept separate from doing it. */
export interface PromotionPlan {
  changes: OpinionChange[];
  toSave: Opinion[];
}

/** Two notes count as the same observation from here up. */
const SAME_OBSERVATION = 0.3;

/** A note needs a second sighting before it earns an opinion of its own. */
const SIGHTINGS_TO_PROMOTE = 2;

const EVIDENCE_CHARS = 120;
const LOW_RATING = 4;
const HIGH_RATING = 7;
const HIGH_CONFIDENCE = 0.85;
const MONTH_DIR = /^\d{4}-\d{2}$/;
const TIME_HEADING = /^## (\d{2}:\d{2})/;
const SCORED_NOTE = /^- ([OB])\(c=([\d.]+)\):\s*(.+)$/;
const WORLD_NOTE = /^- W:\s*(.+)$/;

export function cutoffDate(daysBack: number, now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - daysBack);
  return cutoff;
}

/**
 * One day's note file. A time heading applies to every note under it, so the
 * heading is carried forward rather than re-read per note.
 */
export function parseNoteFile(content: string, date: string): ParsedNote[] {
  const notes: ParsedNote[] = [];
  let time = "";

  for (const line of content.split("\n")) {
    const heading = TIME_HEADING.exec(line);
    if (heading) {
      time = heading[1];
      continue;
    }

    const scored = SCORED_NOTE.exec(line);
    if (scored) {
      notes.push({
        type: scored[1] === "O" ? "O" : "Session",
        confidence: Number.parseFloat(scored[2]),
        text: scored[3],
        date,
        time,
      });
      continue;
    }

    const world = WORLD_NOTE.exec(line);
    if (world) notes.push({ type: "W", text: world[1], date, time });
  }

  return notes;
}

export function loadNotes(
  relationshipDir: string,
  daysBack: number,
  now: Date = new Date()
): ParsedNote[] {
  if (!existsSync(relationshipDir)) return [];

  const cutoff = cutoffDate(daysBack, now);
  const notes: ParsedNote[] = [];

  for (const monthDir of readdirSync(relationshipDir).sort().reverse()) {
    if (!MONTH_DIR.test(monthDir)) continue;
    const monthPath = resolve(relationshipDir, monthDir);

    let files: string[];
    try {
      files = readdirSync(monthPath)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse();
    } catch {
      continue;
    }

    for (const file of files) {
      const date = file.replace(".md", "");
      if (new Date(date) < cutoff) continue;
      try {
        notes.push(
          ...parseNoteFile(readFileSync(resolve(monthPath, file), "utf-8"), date)
        );
      } catch {
        /* unreadable day */
      }
    }
  }

  return notes;
}

export function parseRatings(content: string, daysBack: number, now: Date): Rating[] {
  const cutoff = cutoffDate(daysBack, now).getTime();

  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as Rating;
      } catch {
        return null;
      }
    })
    .filter((r): r is Rating => r !== null && new Date(r.ts).getTime() >= cutoff);
}

export function loadRatings(
  ratingsFile: string,
  daysBack: number,
  now: Date = new Date()
): Rating[] {
  if (!existsSync(ratingsFile)) return [];
  return parseRatings(readFileSync(ratingsFile, "utf-8"), daysBack, now);
}

/**
 * Collapse notes saying the same thing into one group, keyed by the first note
 * that said it. First match wins, so a note joins the earliest group it is
 * close enough to rather than the closest one.
 */
function groupBySimilarity(notes: ParsedNote[]): Map<string, ParsedNote[]> {
  const groups = new Map<string, ParsedNote[]>();

  for (const note of notes) {
    const key = [...groups.keys()].find(
      (existing) => similarity(note.text, existing) >= SAME_OBSERVATION
    );
    if (key === undefined) groups.set(note.text, [note]);
    else groups.get(key)?.push(note);
  }

  return groups;
}

const opinionNotesOf = (notes: ParsedNote[]) => notes.filter((n) => n.type === "O");

/**
 * An observation already tracked gains evidence; one seen twice with nothing
 * tracked becomes an opinion. A single unmatched sighting is left alone — it is
 * an anecdote until it repeats.
 */
export function planPromotions(notes: ParsedNote[], opinions: Opinion[]): PromotionPlan {
  const plan: PromotionPlan = { changes: [], toSave: [] };

  for (const [statement, group] of groupBySimilarity(opinionNotesOf(notes))) {
    const existing = findSimilarOpinion(statement, opinions);

    if (existing) {
      const updated = group.reduce(
        (opinion, note) =>
          addEvidence(opinion, "supporting", note.text.slice(0, EVIDENCE_CHARS)),
        existing
      );
      if (updated.confidence === existing.confidence) continue;
      plan.changes.push({
        statement: existing.statement,
        action: "strengthened",
        oldConfidence: existing.confidence,
        newConfidence: updated.confidence,
      });
      plan.toSave.push(updated);
      continue;
    }

    if (group.length < SIGHTINGS_TO_PROMOTE) continue;
    const opinion = group
      .slice(1)
      .reduce(
        (o, note) => addEvidence(o, "supporting", note.text.slice(0, EVIDENCE_CHARS)),
        createOpinion(statement, group[0].text.slice(0, EVIDENCE_CHARS))
      );
    plan.changes.push({
      statement,
      action: "created",
      newConfidence: opinion.confidence,
    });
    plan.toSave.push(opinion);
  }

  return plan;
}

export function groupNoteOccurrences(notes: ParsedNote[]): OpinionSummary[] {
  return [...groupBySimilarity(opinionNotesOf(notes)).values()]
    .map((group) => {
      const confidences = group
        .map((n) => n.confidence)
        .filter((c): c is number => c !== undefined);
      return {
        text: group[0].text,
        occurrences: group.length,
        avgConfidence:
          confidences.length > 0
            ? confidences.reduce((a, b) => a + b, 0) / confidences.length
            : 0,
        dates: [...new Set(group.map((n) => n.date))],
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences);
}

export function averageRating(ratings: Rating[]): number {
  if (ratings.length === 0) return 0;
  return ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
}

const contextsOf = (ratings: Rating[]) =>
  ratings
    .slice(0, 3)
    .map((r) => `"${r.context.slice(0, 60)}"`)
    .join(", ");

export function correlateRatings(ratings: Rating[]): string[] {
  const low = ratings.filter((r) => r.rating <= LOW_RATING);
  const high = ratings.filter((r) => r.rating >= HIGH_RATING);
  const insights: string[] = [];

  if (low.length > 0) {
    insights.push(
      `${low.length} low ratings (<=${LOW_RATING}) — common contexts: ${contextsOf(low)}`
    );
  }
  if (high.length > 0) {
    insights.push(
      `${high.length} high ratings (>=${HIGH_RATING}) — common contexts: ${contextsOf(high)}`
    );
  }
  if (ratings.length > 0) {
    const explicit = ratings.filter((r) => r.source === "explicit").length;
    insights.push(
      `Source mix: ${explicit} explicit, ${ratings.length - explicit} implicit`
    );
  }

  return insights;
}

const pct = (confidence: number) => Math.round(confidence * 100);

export function changeLine(change: OpinionChange): string {
  if (change.action === "created") {
    return `- **NEW** (${pct(change.newConfidence)}%): ${change.statement}`;
  }
  const from = pct(change.oldConfidence ?? 0);
  return `- **+** ${from}% → ${pct(change.newConfidence)}%: ${change.statement}`;
}

export function formatReport(
  period: string,
  notes: ParsedNote[],
  ratings: Rating[],
  changes: OpinionChange[],
  now: Date = new Date()
): string {
  const lines: string[] = [
    "# Relationship Reflection",
    "",
    `**Period:** ${period}`,
    `**Generated:** ${now.toISOString().slice(0, 10)}`,
    `**Notes analyzed:** ${notes.length}`,
    `**Ratings analyzed:** ${ratings.length}`,
    `**Average Rating:** ${averageRating(ratings).toFixed(1)}/10`,
    "",
    "---",
    "",
  ];

  if (changes.length > 0) {
    lines.push("## Opinion Changes", "", ...changes.map(changeLine), "");
  }

  const summaries = groupNoteOccurrences(notes);
  if (summaries.length > 0) {
    lines.push("## Recurring Opinions", "");
    for (const op of summaries) {
      const stats = `  Seen ${op.occurrences}x | Avg confidence: ${op.avgConfidence.toFixed(2)} | Dates: ${op.dates.join(", ")}`;
      lines.push(`- **${op.text}**`, stats, "");
    }
  }

  const facts = notes.filter((n) => n.type === "W").map((n) => n.text);
  if (facts.length > 0) {
    lines.push(
      "## World Facts Observed",
      "",
      ...facts.slice(0, 10).map((f) => `- ${f}`),
      ""
    );
  }

  const insights = correlateRatings(ratings);
  if (insights.length > 0) {
    lines.push("## Rating Insights", "", ...insights.map((i) => `- ${i}`), "");
  }

  return lines.join("\n");
}

export function reportPath(
  reflectionDir: string,
  period: string,
  now: Date = new Date()
): string {
  const date = now.toISOString().slice(0, 10);
  const slug = period.toLowerCase().replace(/\s+/g, "-");
  return resolve(reflectionDir, `${date}_${slug}-reflection.md`);
}

/** The same changes as the report, abbreviated for a terminal. */
export function consoleLines(
  notes: ParsedNote[],
  ratings: Rating[],
  changes: OpinionChange[]
): string[] {
  const lines = [
    `\nAverage Rating: ${averageRating(ratings).toFixed(1)}/10`,
    `Observations: ${groupNoteOccurrences(notes).length} unique`,
  ];

  if (changes.length === 0) return [...lines, "\nNo opinion changes"];

  lines.push("\nOpinion changes:");
  for (const change of changes) {
    const statement = change.statement.slice(0, 80);
    lines.push(
      change.action === "created"
        ? `  + NEW (${pct(change.newConfidence)}%) ${statement}`
        : `  ~ ${pct(change.oldConfidence ?? 0)}% → ${pct(change.newConfidence)}% ${statement}`
    );
  }
  return lines;
}

/** Nothing to say unless something crossed the bar that gets it into context. */
export function highConfidenceLines(opinions: Opinion[]): string[] {
  const high = opinions.filter((o) => o.confidence >= HIGH_CONFIDENCE);
  if (high.length === 0) return [];
  return [
    "\nHigh-confidence opinions (injected into context):",
    ...high.map((o) => `  [${pct(o.confidence)}%] ${o.statement.slice(0, 80)}`),
  ];
}

/**
 * The learning-analysis report, as lines rather than as console output.
 *
 * The tool around it is spawned, so every judgement in here — which colour a
 * rating average earns, whether an entry came from a failure or a learning,
 * what is shown when there is nothing to show — was written straight into
 * console.log and could not be read back by a test.
 */

import type { AnalysisResult } from "../../hooks/lib/graduation";

type PatternGroup = AnalysisResult["candidates"][number];
type AnalysisEntry = PatternGroup["entries"][number];
type RatingsSummary = NonNullable<AnalysisResult["ratings"]>;

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
};

const RULE = c.dim("─────────────────────────────────────────────────");

/** Green from 7, red at 4 and below, amber for the band between them. */
function averageColour(average: number) {
  if (average >= 7) return c.green;
  return average <= 4 ? c.red : c.yellow;
}

function ratingsLines(r: RatingsSummary): string[] {
  const average = averageColour(r.average)(`${r.average.toFixed(1)}/10`);
  const low = c.red(`Low (≤4): ${r.low.count}`);
  const high = c.green(`High (≥7): ${r.high.count}`);
  return [
    `\n  ${c.bold("Ratings:")} ${average} avg (${r.total} total)`,
    `  ${low} | ${high}`,
  ];
}

/** The source string carries where the entry came from; the tag says which. */
function entryLine(entry: AnalysisEntry, maxChars: number): string {
  const kind = entry.source.startsWith("failure:") ? "failure" : "learning";
  const tag = kind === "failure" ? c.red(`[${kind}]`) : c.yellow(`[${kind}]`);
  return `    ${c.dim(entry.date || "unknown")} ${tag} ${entry.text.slice(0, maxChars)}`;
}

function headingOf(group: PatternGroup): string {
  const domain = c.cyan(`[${group.domain}]`);
  const count = c.bold(`${group.entries.length}x`);
  return `  ${domain} ${count}`;
}

function fileLines(group: PatternGroup): string[] {
  return group.entries.map((entry) => `    ${c.dim(entry.path)}`);
}

function candidateLines(candidate: PatternGroup): string[] {
  const framePath = c.magenta(`memory/wisdom/frames/${candidate.domain}.md`);
  return [
    `${headingOf(candidate)} occurrences`,
    "",
    ...candidate.entries.map((entry) => entryLine(entry, 100)),
    `\n  ${c.dim("Files:")}`,
    ...fileLines(candidate),
    "",
    `  Target frame: ${framePath}`,
    `  ${RULE}\n`,
  ];
}

function emergingLines(group: PatternGroup): string[] {
  return [
    headingOf(group),
    ...group.entries.map((entry) => entryLine(entry, 80)),
    "  Files:",
    ...fileLines(group),
    "",
  ];
}

export function reportLines(result: AnalysisResult): string[] {
  const hasPatterns = result.candidates.length > 0 || result.emerging.length > 0;
  if (!hasPatterns && result.ratings === null) {
    return ["\n  No patterns or ratings data found.\n"];
  }

  const lines: string[] = [];

  if (result.ratings) lines.push(...ratingsLines(result.ratings));

  if (result.candidates.length > 0) {
    const header = `Graduation Report — ${result.candidates.length} pattern(s) detected`;
    lines.push(`\n  ${c.bold(c.green(header))}\n`, `  ${RULE}\n`);
    for (const candidate of result.candidates) lines.push(...candidateLines(candidate));
  }

  if (result.emerging.length > 0) {
    lines.push(`  ${c.bold(c.yellow("Emerging (2x — one more to graduate)"))}\n`);
    for (const group of result.emerging) lines.push(...emergingLines(group));
  }

  if (result.recommendations.length > 0) {
    lines.push(`  ${c.bold("Recommendations:")}\n`);
    for (const rec of result.recommendations) lines.push(`    ${rec}`);
    lines.push("");
  }

  if (result.candidates.length > 0) {
    lines.push(
      "  To crystallize: add a line to the wisdom frame file.",
      `  Format: ${c.green("- Your principle here [CRYSTAL: 85%]")}\n`
    );
  }

  return lines;
}

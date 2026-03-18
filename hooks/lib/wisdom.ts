/**
 * Wisdom Frames — domain-specific crystallized knowledge that compounds across sessions.
 *
 * Frame files live at memory/wisdom/frames/{domain}.md
 * Principles marked [CRYSTAL: ≥85%] are injected into every session.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { addValidation } from "./graduation";
import { paths } from "./paths";

export type ObservationType = "principle" | "rule" | "anti-pattern";

/** Extract CRYSTAL principles (≥85% confidence) from all frame files */
export function readFramePrinciples(): string[] {
  const framesDir = paths.wisdom();
  const principles: string[] = [];

  if (!existsSync(framesDir)) return principles;

  for (const file of readdirSync(framesDir).filter((f) => f.endsWith(".md"))) {
    const content = readFileSync(resolve(framesDir, file), "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/\[CRYSTAL:\s*(\d+)%\]/);
      if (match && parseInt(match[1], 10) >= 85) {
        principles.push(line.trim().replace(/^-\s*/, ""));
      }
    }
  }

  return principles;
}

/** Append an observation to a domain frame file */
export function updateFrame(
  domain: string,
  observation: string,
  type: ObservationType
): void {
  const framesDir = paths.wisdom();
  const filepath = resolve(framesDir, `${domain}.md`);
  const today = new Date().toISOString().slice(0, 10);

  if (!existsSync(filepath)) {
    writeFileSync(
      filepath,
      [
        `# Domain: ${domain}`,
        `Observations: 1 | Last Updated: ${today}`,
        "",
        "## Core Principles",
        "",
        "## Contextual Rules",
        "",
        "## Anti-Patterns",
        "",
        "## Evolution Log",
        `- ${today}: ${observation}`,
        "",
      ].join("\n"),
      "utf-8"
    );
    return;
  }

  let content = readFileSync(filepath, "utf-8");

  // Bump observation count and date
  content = content.replace(
    /Observations: (\d+) \| Last Updated: [\d-]+/,
    (_, n) => `Observations: ${parseInt(n, 10) + 1} | Last Updated: ${today}`
  );

  // Append to evolution log
  content = content.replace(
    "## Evolution Log\n",
    `## Evolution Log\n- ${today}: ${observation}\n`
  );

  // Append entry to the correct section
  const sectionMap: Record<ObservationType, string> = {
    principle: "## Core Principles",
    rule: "## Contextual Rules",
    "anti-pattern": "## Anti-Patterns",
  };
  const suffixMap: Record<ObservationType, string> = {
    principle: "[confidence: 70%]",
    rule: "[confidence: 70%]",
    "anti-pattern": "[severity: medium]",
  };

  const header = sectionMap[type];
  const entry = `- ${observation} ${suffixMap[type]}`;

  // Check for duplicates (by observation text, ignoring confidence tags)
  const existingLines = content.split("\n");
  const isDuplicate = existingLines.some((line) => {
    const cleanLine = line
      .replace(/\s*\[(?:confidence|CRYSTAL|severity):\s*[^\]]+\]\s*$/, "")
      .trim();
    const cleanEntry = entry
      .replace(/\s*\[(?:confidence|CRYSTAL|severity):\s*[^\]]+\]\s*$/, "")
      .trim();
    return cleanLine === cleanEntry;
  });

  if (isDuplicate) {
    // Skip adding duplicate - don't track validation for duplicates
    return;
  }

  content = content.replace(`${header}\n`, `${header}\n${entry}\n`);

  writeFileSync(filepath, content, "utf-8");

  // Track this principle in the validation system
  addValidation(entry, domain, 0);
}

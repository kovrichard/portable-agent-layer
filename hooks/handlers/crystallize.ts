/**
 * UserPromptSubmit handler: manual crystallization commands.
 * Triggers immediate promotion to [CRYSTAL: 90%] regardless of validation count.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { manualCrystallize, updateConfidenceTag } from "../lib/graduation";
import { logDebug, logError } from "../lib/log";
import { paths } from "../lib/paths";

// Match: "graduate principle X", "crystallize Y", "promote Z to crystal"
const CRYSTALLIZE_RE =
  /(?:^|\s)(?:graduate|crystallize|promote)\s+(?:principle\s+)?(.+?)(?:\s+to\s+crystal)?[.!?]?$/i;

export async function handleCrystallizeCommand(message: string): Promise<boolean> {
  const match = message.match(CRYSTALLIZE_RE);
  if (!match) return false;

  const query = match[1].trim().toLowerCase();
  if (query.length < 3) return false;

  logDebug("crystallize", `Searching for principle matching: "${query}"`);

  // Search all frame files for matching principle
  const framesDir = paths.wisdom();
  if (!existsSync(framesDir)) {
    logError("crystallize", "Wisdom frames directory does not exist");
    return false;
  }

  let bestMatch: {
    domain: string;
    line: string;
    index: number;
    filepath: string;
  } | null = null;

  for (const file of readdirSync(framesDir).filter((f) => f.endsWith(".md"))) {
    const domain = file.replace(".md", "");
    const filepath = resolve(framesDir, file);
    const content = readFileSync(filepath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Only match lines with confidence tags (not already crystal)
      if (!line.includes("[confidence:") && !line.includes("[CRYSTAL:")) {
        continue;
      }

      const cleanLine = line
        .toLowerCase()
        .replace(/^-\s*/, "")
        .replace(/\[.*?\]/g, "")
        .trim();
      if (cleanLine.includes(query)) {
        // Prefer lines with confidence tags over crystal
        if (line.includes("[confidence:")) {
          bestMatch = { domain, line, index: i, filepath };
          break; // Found a good match
        } else if (!bestMatch) {
          bestMatch = { domain, line, index: i, filepath };
        }
      }
    }

    if (bestMatch?.line.includes("[confidence:")) break;
  }

  if (!bestMatch) {
    logDebug("crystallize", `No principle found matching "${query}"`);
    return false;
  }

  // Promote to crystal
  try {
    const { success } = manualCrystallize(bestMatch.line, bestMatch.domain);
    if (!success) {
      logError("crystallize", "Failed to crystallize principle");
      return false;
    }

    // Update the frame file
    const content = readFileSync(bestMatch.filepath, "utf-8");
    const lines = content.split("\n");
    const oldLine = lines[bestMatch.index];
    const newLine = updateConfidenceTag(oldLine, 90);

    if (newLine !== oldLine) {
      lines[bestMatch.index] = newLine;
      writeFileSync(bestMatch.filepath, lines.join("\n"), "utf-8");

      logDebug("crystallize", `Crystallized principle in ${bestMatch.domain}.md`);
      return true;
    }
  } catch (err) {
    logError("crystallize", err);
    return false;
  }

  return false;
}

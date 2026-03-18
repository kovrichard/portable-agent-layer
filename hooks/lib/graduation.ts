/**
 * Graduation System — manual crystallization only (like original PAI)
 *
 * Principles start at [confidence: 70%] in Evolution Log
 * User manually promotes to [CRYSTAL: 90%] via command or file edit
 * No automatic validation counting or promotion
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

/** Generate hash from principle text (first 60 chars) */
export function hashPrinciple(text: string): string {
  return text
    .toLowerCase()
    .slice(0, 60)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Extract confidence level from principle text */
export function extractConfidence(text: string): number | null {
  const match = text.match(/\[(?:confidence|CRYSTAL):\s*(\d+)%\]/);
  return match ? parseInt(match[1], 10) : null;
}

/** Update confidence tag in principle text */
export function updateConfidenceTag(text: string, newConfidence: number): string {
  const current = extractConfidence(text);
  if (current === null) return text;

  const oldTag = current >= 90 ? "CRYSTAL" : "confidence";
  const newTag = newConfidence >= 90 ? "CRYSTAL" : "confidence";

  return text.replace(`[${oldTag}: ${current}%]`, `[${newTag}: ${newConfidence}%]`);
}

/** Scan all frame files for principles with confidence tags */
export function getAllPrinciples(): Array<{
  text: string;
  domain: string;
  confidence: number;
  filepath: string;
}> {
  const framesDir = paths.wisdom();
  const principles: ReturnType<typeof getAllPrinciples> = [];

  if (!existsSync(framesDir)) return principles;

  for (const file of readdirSync(framesDir).filter((f) => f.endsWith(".md"))) {
    const domain = file.replace(".md", "");
    const filepath = resolve(framesDir, file);
    const content = readFileSync(filepath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      const confidence = extractConfidence(line);
      if (confidence !== null) {
        principles.push({
          text: line.trim().replace(/^-\s*/, ""),
          domain,
          confidence,
          filepath,
        });
      }
    }
  }

  return principles;
}

/** Manually crystallize a principle (immediate promotion to CRYSTAL) */
export function manualCrystallize(
  text: string,
  domain: string
): { success: boolean; newConfidence: number } {
  const framesDir = paths.wisdom();
  const filepath = resolve(framesDir, `${domain}.md`);

  if (!existsSync(filepath)) {
    return { success: false, newConfidence: 70 };
  }

  const content = readFileSync(filepath, "utf-8");
  const lines = content.split("\n");
  let modified = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(text.slice(0, 60))) {
      const confidence = extractConfidence(line);
      if (confidence !== null && confidence < 90) {
        lines[i] = updateConfidenceTag(line, 90);
        modified = true;
        break;
      }
    }
  }

  if (modified) {
    writeFileSync(filepath, lines.join("\n"), "utf-8");
    return { success: true, newConfidence: 90 };
  }

  return { success: false, newConfidence: 70 };
}

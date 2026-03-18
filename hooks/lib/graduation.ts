/**
 * Graduation System — tracks principle validations and promotes them through confidence tiers.
 *
 * Tiers: 70% → 85% → 90% [CRYSTAL]
 * Threshold: 3 validations per tier
 * Storage: memory/wisdom/state/validation-counter.json
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

export interface PrincipleValidation {
  hash: string;
  text: string;
  domain: string;
  currentConfidence: 70 | 85 | 90;
  validations: number;
  lastValidated: string;
  isCrystal: boolean;
}

export interface ValidationCounter {
  principles: Record<string, PrincipleValidation>;
  lastUpdated: string;
}

const VALIDATION_THRESHOLD = 3;

/** Get validation counter file path (configurable via PAI_VALIDATION_COUNTER env var) */
function getValidationCounterPath(): string {
  const customPath = process.env.PAI_VALIDATION_COUNTER;
  if (customPath) {
    return resolve(customPath);
  }
  return resolve(paths.wisdomState(), "validation-counter.json");
}

/** Generate hash from principle text (first 60 chars) */
export function hashPrinciple(text: string): string {
  return text
    .toLowerCase()
    .slice(0, 60)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Read validation counter from disk */
function readValidationCounter(): ValidationCounter {
  const counterPath = getValidationCounterPath();
  if (!existsSync(counterPath)) {
    return { principles: {}, lastUpdated: new Date().toISOString() };
  }
  try {
    return JSON.parse(readFileSync(counterPath, "utf-8")) as ValidationCounter;
  } catch {
    return { principles: {}, lastUpdated: new Date().toISOString() };
  }
}

/** Write validation counter to disk */
function writeValidationCounter(counter: ValidationCounter): void {
  const counterPath = getValidationCounterPath();
  counter.lastUpdated = new Date().toISOString();
  writeFileSync(counterPath, JSON.stringify(counter, null, 2), "utf-8");
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

/** Add validation to a principle */
export function addValidation(
  text: string,
  domain: string,
  bonus = 0
): { promoted: boolean; newConfidence: number | null } {
  const hash = hashPrinciple(text);
  const counter = readValidationCounter();

  let principle = counter.principles[hash];
  if (!principle) {
    const confidence = extractConfidence(text) || 70;
    principle = {
      hash,
      text: text.slice(0, 200),
      domain,
      currentConfidence: confidence as 70 | 85 | 90,
      validations: 0,
      lastValidated: new Date().toISOString(),
      isCrystal: confidence >= 90,
    };
  }

  principle.validations += 1 + bonus;
  principle.lastValidated = new Date().toISOString();

  let promoted = false;
  let newConfidence: number | null = null;

  // Check for promotion
  if (!principle.isCrystal && principle.validations >= VALIDATION_THRESHOLD) {
    if (principle.currentConfidence === 70) {
      principle.currentConfidence = 85;
      principle.validations = 0; // Reset for next tier
      promoted = true;
      newConfidence = 85;
    } else if (principle.currentConfidence === 85) {
      principle.currentConfidence = 90;
      principle.isCrystal = true;
      principle.validations = 0;
      promoted = true;
      newConfidence = 90;
    }
  }

  counter.principles[hash] = principle;
  writeValidationCounter(counter);

  return { promoted, newConfidence };
}

/** Manually crystallize a principle (bypasses validation count) */
export function manualCrystallize(
  text: string,
  domain: string
): { success: boolean; newConfidence: number } {
  const hash = hashPrinciple(text);
  const counter = readValidationCounter();

  counter.principles[hash] = {
    hash,
    text: text.slice(0, 200),
    domain,
    currentConfidence: 90,
    validations: 3,
    lastValidated: new Date().toISOString(),
    isCrystal: true,
  };

  writeValidationCounter(counter);

  return { success: true, newConfidence: 90 };
}

/** Get all principles ready for promotion */
export function getPromotablePrinciples(): Array<{
  hash: string;
  text: string;
  domain: string;
  currentConfidence: number;
  validations: number;
  needed: number;
}> {
  const counter = readValidationCounter();
  const promotable: ReturnType<typeof getPromotablePrinciples> = [];

  for (const principle of Object.values(counter.principles)) {
    if (!principle.isCrystal && principle.validations < VALIDATION_THRESHOLD) {
      promotable.push({
        hash: principle.hash,
        text: principle.text,
        domain: principle.domain,
        currentConfidence: principle.currentConfidence,
        validations: principle.validations,
        needed: VALIDATION_THRESHOLD - principle.validations,
      });
    }
  }

  return promotable;
}

/** Scan all frame files and promote principles that reached threshold */
export function runGraduation(): {
  promoted: Array<{ text: string; domain: string; from: number; to: number }>;
  approaching: Array<{
    text: string;
    domain: string;
    confidence: number;
    validations: number;
    needed: number;
  }>;
} {
  const framesDir = paths.wisdom();
  const promoted: ReturnType<typeof runGraduation>["promoted"] = [];
  const approaching: ReturnType<typeof runGraduation>["approaching"] = [];

  if (!existsSync(framesDir)) {
    return { promoted, approaching };
  }

  const { readdirSync, readFileSync, writeFileSync } = require("node:fs");
  const { resolve } = require("node:path");

  for (const file of readdirSync(framesDir).filter((f: string) => f.endsWith(".md"))) {
    const domain = file.replace(".md", "");
    const filepath = resolve(framesDir, file);
    const content = readFileSync(filepath, "utf-8");
    let modified = false;

    // Find principles with confidence tags
    const lines = content.split("\n");
    const newLines: string[] = [];

    for (const line of lines) {
      const confidence = extractConfidence(line);
      if (confidence && confidence < 90) {
        const hash = hashPrinciple(line);
        const counter = readValidationCounter();
        const principle = counter.principles[hash];

        if (principle && principle.validations >= VALIDATION_THRESHOLD) {
          // Promote this principle
          const oldConfidence = principle.currentConfidence;
          let newConfidence: number;

          if (oldConfidence === 70) {
            newConfidence = 85;
            principle.currentConfidence = 85;
            principle.validations = 0;
          } else {
            newConfidence = 90;
            principle.currentConfidence = 90;
            principle.isCrystal = true;
            principle.validations = 0;
          }

          // Update the line
          const oldTag = confidence >= 90 ? "CRYSTAL" : "confidence";
          const newLine = line.replace(
            `[${oldTag}: ${confidence}%]`,
            `[${newConfidence >= 90 ? "CRYSTAL" : "confidence"}: ${newConfidence}%]`
          );

          newLines.push(newLine);
          promoted.push({
            text: line.trim().replace(/^-\s*/, "").slice(0, 100),
            domain,
            from: oldConfidence,
            to: newConfidence,
          });

          counter.principles[hash] = principle;
          writeValidationCounter(counter);
          modified = true;
          continue;
        } else if (principle) {
          // Check if counter has higher confidence than frame file (sync needed)
          if (principle.currentConfidence > confidence) {
            // Sync frame file to match counter
            const newLine = line.replace(
              `[confidence: ${confidence}%]`,
              `[${principle.currentConfidence >= 90 ? "CRYSTAL" : "confidence"}: ${principle.currentConfidence}%]`
            );
            newLines.push(newLine);
            promoted.push({
              text: line.trim().replace(/^-\s*/, "").slice(0, 100),
              domain,
              from: confidence,
              to: principle.currentConfidence,
            });
            modified = true;
            continue;
          }

          // Track as approaching
          approaching.push({
            text: line.trim().replace(/^-\s*/, "").slice(0, 100),
            domain,
            confidence: principle.currentConfidence,
            validations: principle.validations,
            needed: VALIDATION_THRESHOLD - principle.validations,
          });
        }
      }
      newLines.push(line);
    }

    if (modified) {
      writeFileSync(filepath, newLines.join("\n"), "utf-8");
    }
  }

  return { promoted, approaching };
}

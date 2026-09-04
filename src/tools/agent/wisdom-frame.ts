#!/usr/bin/env bun
/**
 * WisdomFrameUpdater — Update wisdom frames with new observations.
 *
 * Takes a domain and observation, updates the appropriate frame file.
 * Creates the frame if it doesn't exist. Tracks observation count and
 * evolution log. Principles are marked [CRYSTAL: N%] manually when
 * confidence is high enough.
 *
 * Usage:
 *   bun run tool:wisdom-frame --domain communication --observation "prefers bullet points"
 *   bun run tool:wisdom-frame --domain development --observation "refactoring without tests caused regressions" --type anti-pattern
 *   bun run tool:wisdom-frame --domain workflow --observation "always run type-check after edits" --type principle
 *
 * Types: principle, contextual-rule, anti-pattern, evolution (default)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { paths } from "../../hooks/lib/paths";
import { emit } from "../lib/emit";

// ── Types ──

type ObservationType = "principle" | "contextual-rule" | "anti-pattern" | "evolution";

interface UpdateResult {
  success: boolean;
  domain: string;
  type: ObservationType;
  message: string;
  framePath: string;
}

// ── Helpers ──

function date(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseObservationCount(content: string): number {
  const match = new RegExp(/\*\*Observation Count:\*\*\s*(\d+)/).exec(content);
  return match ? parseInt(match[1], 10) : 0;
}

function incrementCount(content: string): string {
  const current = parseObservationCount(content);
  return content.replace(/(\*\*Observation Count:\*\*\s*)\d+/, `$1${current + 1}`);
}

function updateDate(content: string): string {
  return content.replace(/(\*\*Last Updated:\*\*\s*)\S+/, `$1${date()}`);
}

function appendToSection(
  content: string,
  sectionHeader: string,
  entry: string,
  fallbackBefore?: string
): string {
  const idx = content.indexOf(sectionHeader);

  if (idx === -1) {
    // Section doesn't exist — insert before fallback or at end
    const insertAt = fallbackBefore ? content.indexOf(fallbackBefore) : -1;
    const pos = insertAt !== -1 ? insertAt : content.length;
    return `${content.slice(0, pos)}${sectionHeader}\n\n${entry}\n\n${content.slice(pos)}`;
  }

  // Find end of section (next ## or EOF)
  const afterSection = content.slice(idx + sectionHeader.length);
  const nextSection = afterSection.indexOf("\n## ");
  const insertPoint =
    nextSection === -1 ? content.length : idx + sectionHeader.length + nextSection;

  return `${content.slice(0, insertPoint)}\n${entry}${content.slice(insertPoint)}`;
}

// ── Core Update ──

export function updateFrame(
  domain: string,
  observation: string,
  type: ObservationType = "evolution"
): UpdateResult {
  const framesDir = paths.wisdom();
  const framePath = resolve(framesDir, `${domain}.md`);

  // Create frame if it doesn't exist
  if (!existsSync(framePath)) {
    mkdirSync(framesDir, { recursive: true });

    const contextualRuleEntry =
      type === "contextual-rule" ? `- ${observation} (${date()})` : "*None yet.*";
    const antiPatternEntry =
      type === "anti-pattern"
        ? `### ${observation}\n- **Severity:** Medium\n- **Frequency:** Observed`
        : "*None yet.*";
    const content = `# Frame: ${domain.charAt(0).toUpperCase() + domain.slice(1)}

## Meta
- **Domain:** ${domain}
- **Observation Count:** 1
- **Last Updated:** ${date()}

---

## Core Principles

*No crystallized principles yet. Observations accumulating.*

---

## Contextual Rules

${contextualRuleEntry}

---

## Anti-Patterns

${antiPatternEntry}

---

## Evolution Log
- ${date()}: Frame created — ${observation}
`;

    writeFileSync(framePath, content);
    return {
      success: true,
      domain,
      type,
      message: `Created new frame "${domain}" with initial observation`,
      framePath,
    };
  }

  // Update existing frame
  let content = readFileSync(framePath, "utf-8");
  content = incrementCount(content);
  content = updateDate(content);

  const evolutionEntry = `- ${date()}: ${observation}`;

  switch (type) {
    case "anti-pattern":
      content = appendToSection(
        content,
        "## Anti-Patterns",
        `\n### ${observation}\n- **Severity:** Medium\n- **Frequency:** Observed`,
        "## Evolution Log"
      );
      content = appendToSection(content, "## Evolution Log", evolutionEntry);
      break;

    case "contextual-rule":
      content = appendToSection(
        content,
        "## Contextual Rules",
        `- ${observation} (${date()})`,
        "## Anti-Patterns"
      );
      content = appendToSection(content, "## Evolution Log", evolutionEntry);
      break;

    case "principle":
      // Principles logged for manual crystallization — don't auto-add to Core Principles
      content = appendToSection(
        content,
        "## Evolution Log",
        `- ${date()}: Principle candidate — ${observation}`
      );
      break;
    default:
      content = appendToSection(content, "## Evolution Log", evolutionEntry);
      break;
  }

  writeFileSync(framePath, content);

  return {
    success: true,
    domain,
    type,
    message: `Updated "${domain}" frame with ${type}: ${observation}`,
    framePath,
  };
}

// ── CLI ──

function run() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      domain: { type: "string", short: "d" },
      observation: { type: "string", short: "o" },
      type: { type: "string", short: "t" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
WisdomFrameUpdater — Update wisdom frames with observations

Usage:
  bun run tool:wisdom-frame --domain <domain> --observation "text" [--type <type>]

Domains:
  development, workflow, communication, infrastructure, integration, or any custom domain

Types:
  principle        High-confidence pattern (logged for manual crystallization)
  contextual-rule  Context-specific behavioral rule
  anti-pattern     Something to avoid
  evolution        General observation (default)

Examples:
  bun run tool:wisdom-frame -d workflow -o "always run type-check after edits"
  bun run tool:wisdom-frame -d development -o "mocking DB hides migration bugs" -t anti-pattern
  bun run tool:wisdom-frame -d communication -o "user prefers terse summaries" -t principle
`);
    process.exit(0);
  }

  if (!values.domain || !values.observation) {
    console.error("Required: --domain and --observation");
    process.exit(1);
  }

  const cliType = (values.type || "evolution") as ObservationType;
  const result = updateFrame(values.domain, values.observation, cliType);
  emit.receipt(result.framePath, { domain: result.domain, type: result.type });
}

if (import.meta.main) run();

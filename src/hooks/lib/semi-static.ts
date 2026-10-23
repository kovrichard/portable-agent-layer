/**
 * Semi-static context source registry.
 *
 * One entry here = the only change needed to add a new source across all consumers:
 * CLAUDE.md @imports, opencode instructions[], Cursor .mdc, Copilot .instructions.md,
 * Antigravity plugin rules, and the session-stop digest writer.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { opinionsContext } from "./adaptation-rules";
import { palHome, paths } from "./paths";
import { readFramePrinciples } from "./wisdom";

/** A single semi-static context source — built at session stop, loaded natively at session start. */
interface SemiStaticSource {
  /** Absolute path used in @imports (CLAUDE.md), instructions[] (opencode), and digest writes. */
  readonly path: string;
  /** When true, session-stop handler writes build result to path. */
  readonly writesDigest: boolean;
  /** Returns current content — builds fresh when writesDigest is true, reads the file otherwise. */
  load(): string;
  /** Slug for the pal-${slug} rule/instruction files written for Cursor, Copilot and Antigravity. */
  readonly slug: string;
  /** Human-readable description for Cursor .mdc and Antigravity rule frontmatter. */
  readonly description: string;
}

/** Returns the Cursor rules filename for a source. */
export function cursorFilename(src: SemiStaticSource): string {
  return `pal-${src.slug}.mdc`;
}

/** Returns the Copilot instructions filename for a source. */
export function copilotFilename(src: SemiStaticSource): string {
  return `pal-${src.slug}.instructions.md`;
}

/** Returns the Antigravity plugin rule filename for a source. */
export function antigravityFilename(src: SemiStaticSource): string {
  return `pal-${src.slug}.md`;
}

/** An Antigravity rule file; a rule without a valid `trigger` is silently discarded. */
export function antigravityRule(description: string, content: string): string {
  return `---\ntrigger: always_on\ndescription: ${description}\n---\n\n${content}`;
}

export function readFileSafe(path: string): string {
  try {
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf-8").trim();
  } catch {
    return "";
  }
}

function steeringRulesPath(): string {
  return resolve(palHome(), "docs", "STEERING_RULES.md");
}

export function loadSteeringRules(): string {
  return readFileSafe(steeringRulesPath());
}

/**
 * All semi-static context sources in load order.
 * Adding one entry here is the only change needed to extend coverage to all consumers.
 */
export function getSemiStaticSources(): SemiStaticSource[] {
  const memory = paths.memory();
  return [
    {
      path: resolve(memory, "self-model", "current.md"),
      writesDigest: false,
      load: () => readFileSafe(resolve(memory, "self-model", "current.md")),
      slug: "self-model",
      description: "PAL self-model",
    },
    {
      path: resolve(memory, "wisdom", "context.md"),
      writesDigest: true,
      load: () => {
        try {
          const principles = readFramePrinciples();
          if (principles.length === 0) return "";
          return ["## Crystallized Principles", ...principles.map((p) => `- ${p}`)].join(
            "\n"
          );
        } catch {
          return "";
        }
      },
      slug: "wisdom",
      description: "PAL wisdom",
    },
    {
      path: resolve(memory, "relationship", "opinions-context.md"),
      writesDigest: true,
      load: () => {
        try {
          return opinionsContext();
        } catch {
          return "";
        }
      },
      slug: "opinions",
      description: "PAL opinions",
    },
    {
      path: steeringRulesPath(),
      writesDigest: false,
      load: loadSteeringRules,
      slug: "steering",
      description: "PAL steering rules",
    },
  ];
}

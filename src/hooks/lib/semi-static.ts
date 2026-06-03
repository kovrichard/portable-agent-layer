/**
 * Semi-static context source registry.
 *
 * One entry here = the only change needed to add a new source across all consumers:
 * CLAUDE.md @imports, opencode instructions[], Cursor .mdc, Copilot .instructions.md,
 * and the session-stop digest writer.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type FailureEntry, readFailures } from "./learning-store";
import { loadOpinionContext } from "./opinions";
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
  /** Slug for ~/.cursor/rules/pal-${slug}.mdc and ~/.copilot/instructions/pal-${slug}.instructions.md */
  readonly slug: string;
  /** Human-readable description for Cursor .mdc frontmatter. */
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

function readFileSafe(path: string): string {
  try {
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf-8").trim();
  } catch {
    return "";
  }
}

/**
 * Rank failures for injection: same-project (cwd match) first, then by recency.
 * Project-relevant lessons are never crowded out by more-recent other-project
 * ones — fixing the case where (e.g.) a web-app's cache lessons dominate a CLI
 * session purely because they were logged last. Returns the top `limit`.
 */
export function rankFailures(
  entries: FailureEntry[],
  cwd: string,
  limit = 5
): FailureEntry[] {
  return [...entries]
    .sort((a, b) => {
      const am = a.cwd === cwd;
      const bm = b.cwd === cwd;
      if (am !== bm) return am ? -1 : 1;
      return (b.ts || "").localeCompare(a.ts || ""); // recency desc within a group
    })
    .slice(0, limit);
}

/** Build the failure avoid-list, prioritized by relevance to the current project. */
export function loadFailurePatterns(): string {
  try {
    const cwd = process.cwd();
    const all = readFailures(paths.failures());
    if (all.length === 0) return "";

    const lines = rankFailures(all, cwd).map((e) => {
      const label = e.rating ? `[${e.rating}/10]` : "";
      const tag = e.cwd === cwd ? "[project]" : "[other]";
      const text = e.principle || e.context;
      return `- ${label} ${tag} ${text}`.trim();
    });

    return ["## Lessons from Recent Failures — Apply These Now", ...lines].join("\n");
  } catch {
    return "";
  }
}

/**
 * All semi-static context sources in load order.
 * Adding one entry here is the only change needed to extend coverage to all consumers.
 */
export function getSemiStaticSources(): SemiStaticSource[] {
  const memory = paths.memory();
  const home = palHome();
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
          return loadOpinionContext();
        } catch {
          return "";
        }
      },
      slug: "opinions",
      description: "PAL opinions",
    },
    {
      path: resolve(memory, "learning", "failures-digest.md"),
      writesDigest: true,
      load: loadFailurePatterns,
      slug: "failures",
      description: "PAL recent failure lessons",
    },
    {
      path: resolve(home, "docs", "STEERING_RULES.md"),
      writesDigest: false,
      load: () => readFileSafe(resolve(home, "docs", "STEERING_RULES.md")),
      slug: "steering",
      description: "PAL steering rules",
    },
  ];
}

/**
 * Semi-static context source registry.
 *
 * One entry here = the only change needed to add a new source across all consumers:
 * CLAUDE.md @imports, opencode instructions[], Cursor .mdc, Copilot .instructions.md,
 * and the session-stop digest writer.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "./frontmatter";
import { readFailures } from "./learning-store";
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

/** Build recommendations from the most recent synthesis report. */
export function loadSynthesisRecommendations(): string {
  try {
    const synthDir = paths.synthesis();
    if (!existsSync(synthDir)) return "";

    const months = readdirSync(synthDir).sort().reverse();
    for (const month of months) {
      const monthDir = resolve(synthDir, month);
      try {
        const files = readdirSync(monthDir)
          .filter((f) => f.endsWith(".md"))
          .sort()
          .reverse();
        if (files.length === 0) continue;

        const content = readFileSync(resolve(monthDir, files[0]), "utf-8");

        const recMatch = new RegExp(
          /## Recommendations\n\n([\s\S]*?)(?:\n##|\n$|$)/
        ).exec(content);
        if (!recMatch?.[1]?.trim()) continue;

        const recs = recMatch[1]
          .trim()
          .split("\n")
          .filter((l) => l.trim())
          .slice(0, 4);

        if (recs.length === 0) continue;

        const { meta } = parse<{ period?: string; average_rating?: string }>(content);
        const period = meta.period ?? "";
        const avgRating = meta.average_rating ? `${meta.average_rating}/10` : "";

        const header = [
          "## Pattern Synthesis",
          period ? `*${period} — ${avgRating}*` : "",
        ]
          .filter(Boolean)
          .join("\n");

        return [header, ...recs].join("\n");
      } catch {
        /* try next month */
      }
    }
    return "";
  } catch {
    return "";
  }
}

/** Build the 5 most recent failure lessons as an avoid-list. */
export function loadFailurePatterns(): string {
  try {
    const entries = readFailures(paths.failures(), 5);
    if (entries.length === 0) return "";

    const lines = entries.map((e) => {
      const label = e.rating ? `[${e.rating}/10]` : "";
      const text = e.principle || e.context;
      return `- ${label} ${text}`.trim();
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
      path: resolve(memory, "learning", "synthesis-digest.md"),
      writesDigest: true,
      load: loadSynthesisRecommendations,
      slug: "synthesis",
      description: "PAL pattern synthesis",
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

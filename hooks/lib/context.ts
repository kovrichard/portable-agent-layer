/**
 * Shared context builders for session startup.
 * Used by LoadContext.ts (Claude Code) and the opencode plugin.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";
import { loadRecentNotes } from "./relationship";
import { readSessionNames } from "./session-names";
import { buildSetupPrompt, readSetupState, remainingSteps, STEP_ORDER } from "./setup";
import { computeSignalTrends, formatTrends } from "./signal-trends";
import { readFramePrinciples } from "./wisdom";
import {
  activeProjects,
  readSessions,
  recentSessions,
  staleProjects,
} from "./work-tracking";

/** Load all populated TELOS files as a single markdown string */
export function loadTelos(): string {
  const telosDir = paths.telos();
  if (!existsSync(telosDir)) return "";

  const files = readdirSync(telosDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const sections: string[] = [];

  for (const file of files) {
    const content = readFileSync(resolve(telosDir, file), "utf-8").trim();
    // Skip empty templates (only have a heading and comment)
    const realLines = content
      .split("\n")
      .filter(
        (l) =>
          !l.startsWith("#") && !l.startsWith("<!--") && !l.startsWith("-->") && l.trim()
      );
    if (realLines.length === 0) continue;
    sections.push(content);
  }

  return sections.join("\n\n---\n\n");
}

/** Count lines in a signals JSONL file */
export function countSignals(filename: string): number {
  const filepath = resolve(paths.signals(), filename);
  if (!existsSync(filepath)) return 0;
  try {
    const content = readFileSync(filepath, "utf-8").trim();
    return content ? content.split("\n").length : 0;
  } catch {
    return 0;
  }
}

/** Load structured session history + project dashboard */
export function loadActiveWork(): { text: string; summary: string | null } | null {
  try {
    const recent = recentSessions(48);
    const projects = activeProjects();
    const stale = staleProjects(7);

    if (recent.length === 0 && projects.length === 0) return null;

    const lines: string[] = [];

    if (recent.length > 0) {
      lines.push("## Recent Work (last 48h)");
      for (const s of recent.slice(-10).reverse()) {
        const ago = formatAgo(s.ts);
        lines.push(`- [${s.status}] ${s.name} — ${ago}`);
        if (s.handoff) {
          lines.push(`  Handoff: ${s.handoff.split("\n")[0].slice(0, 120)}`);
        }
      }
    }

    if (projects.length > 0) {
      lines.push("", "### Active Projects");
      for (const p of projects) {
        const sessionCount = p.sessions.length;
        const ago = formatAgo(p.updated);
        lines.push(`- **${p.name}** (${sessionCount} sessions, last: ${ago})`);
        if (p.nextSteps.length > 0) {
          lines.push(`  Next: ${p.nextSteps[0]}`);
        }
        if (p.blockers.length > 0) {
          lines.push(`  Blockers: ${p.blockers.join(", ")}`);
        } else {
          lines.push("  Blockers: None");
        }
      }
    }

    if (stale.length > 0) {
      lines.push("", "### Stale Projects (>7d inactive)");
      for (const p of stale) {
        lines.push(`- **${p.name}** — last active ${formatAgo(p.updated)}`);
      }
    }

    // Summary from most recent session
    const last = recent.length > 0 ? recent[recent.length - 1] : null;
    const summary = last?.summary?.slice(0, 60) || null;

    return {
      text: lines.join("\n"),
      summary: summary ? `"${summary}"` : null,
    };
  } catch {
    return null;
  }
}

/** Format a timestamp as a human-readable "X ago" string */
function formatAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Load the N most recent session names (fallback for greeting) */
export function loadRecentSessions(count: number): string[] {
  try {
    const sessions = readSessions();
    if (sessions.length > 0) {
      return sessions
        .slice(-count)
        .reverse()
        .map((s) => s.name);
    }
    // Fallback to session-names.json for backwards compat
    const names = readSessionNames();
    const entries = Object.values(names);
    return entries.slice(-count).reverse();
  } catch {
    return [];
  }
}

/** Read cached counts from counts.json, falling back to live counting */
function loadCachedCounts(): {
  signals: number;
  telos: number;
  skills: number;
  sessions: number;
} {
  try {
    const countsPath = resolve(paths.state(), "counts.json");
    if (existsSync(countsPath)) {
      return JSON.parse(readFileSync(countsPath, "utf-8"));
    }
  } catch {
    /* fall through */
  }
  // Fallback: count live (first session before any stop has run)
  return {
    signals: countSignals("ratings.jsonl") + countSignals("learnings.jsonl"),
    telos: 0,
    skills: 0,
    sessions: 0,
  };
}

/** Build the visible greeting lines for stderr */
export function buildGreeting(): string[] {
  const counts = loadCachedCounts();
  const work = loadActiveWork();
  const setupState = readSetupState();
  const setupPrompt = setupState ? buildSetupPrompt(setupState) : null;

  const greeting: string[] = [];

  if (setupPrompt) {
    const done = STEP_ORDER.length - (setupState ? remainingSteps(setupState).length : 0);
    greeting.push(
      `🔧 PAI setup ${done}/${STEP_ORDER.length} | ${counts.signals} signals`
    );
  } else {
    greeting.push(
      `✅ PAI ready | ${counts.telos} TELOS | ${counts.skills} skills | ${counts.signals} signals | ${counts.sessions} sessions`
    );
  }

  if (work?.summary) {
    greeting.push(`📋 Previous: ${work.summary}`);
  }

  // Show recent session names for quick context
  const recent = loadRecentSessions(3);
  if (recent.length > 0) {
    greeting.push(`📂 Recent: ${recent.join(" | ")}`);
  }

  return greeting;
}

/** Load high-confidence wisdom principles for injection into system-reminder */
export function loadWisdomContext(): string {
  try {
    const principles = readFramePrinciples();
    if (principles.length === 0) return "";
    return ["## Crystallized Principles", ...principles.map((p) => `- ${p}`)].join("\n");
  } catch {
    return "";
  }
}

/** Load 3 most recent session learning files as digest */
export function loadLearningDigest(): string {
  try {
    const sessionDir = paths.sessionLearning();
    if (!existsSync(sessionDir)) return "";

    const files: string[] = [];
    for (const month of readdirSync(sessionDir).sort().reverse()) {
      const monthPath = resolve(sessionDir, month);
      try {
        const monthFiles = readdirSync(monthPath)
          .filter((f) => f.endsWith(".md"))
          .sort()
          .reverse()
          .map((f) => resolve(monthPath, f));
        files.push(...monthFiles);
      } catch {
        /* skip */
      }
      if (files.length >= 3) break;
    }

    const excerpts = files.slice(0, 3).map((f) => {
      const content = readFileSync(f, "utf-8").trim();
      // Extract title line
      const titleLine = content.split("\n").find((l) => l.startsWith("**Title:**")) ?? "";
      return titleLine || content.slice(0, 80);
    });

    if (excerpts.length === 0) return "";
    return ["## Recent Session Learnings", ...excerpts.map((e) => `- ${e}`)].join("\n");
  } catch {
    return "";
  }
}

/** Load 5 most recent failure slugs as an "avoid" list */
export function loadFailurePatterns(): string {
  try {
    const failuresDir = paths.failures();
    if (!existsSync(failuresDir)) return "";

    // Structure: failures/{year}/{month}/{timestamp}_{slug}/
    const slugs: string[] = [];
    for (const year of readdirSync(failuresDir).sort().reverse()) {
      const yearPath = resolve(failuresDir, year);
      for (const month of readdirSync(yearPath).sort().reverse()) {
        const monthPath = resolve(yearPath, month);
        try {
          const dirs = readdirSync(monthPath).sort().reverse();
          for (const dir of dirs) {
            const slug = dir.replace(/^\d{8}-\d{6}_/, "");
            if (slug !== dir) slugs.push(slug);
            if (slugs.length >= 5) break;
          }
        } catch {
          /* skip */
        }
        if (slugs.length >= 5) break;
      }
      if (slugs.length >= 5) break;
    }

    if (slugs.length === 0) return "";
    return ["## Recent Failure Patterns (Avoid)", ...slugs.map((s) => `- ${s}`)].join(
      "\n"
    );
  } catch {
    return "";
  }
}

/** Load signal trends as a formatted string */
export function loadSignalTrends(): string {
  try {
    return formatTrends(computeSignalTrends());
  } catch {
    return "";
  }
}

/** Load recent relationship notes (today + yesterday) */
export function loadRelationshipContext(): string {
  try {
    const notes = loadRecentNotes(2);
    if (!notes) return "";
    return `## Recent Interaction Notes\n${notes}`;
  } catch {
    return "";
  }
}

/**
 * Build the <system-reminder> content for the AI.
 *
 * Static context (TELOS, setup prompt) lives in AGENTS.md / CLAUDE.md and is
 * loaded natively by Claude Code / opencode. This injects dynamic context only —
 * things that change per-session and can't live in a static file.
 */
export function buildSystemReminder(): string {
  const work = loadActiveWork();
  const wisdom = loadWisdomContext();
  const relationship = loadRelationshipContext();
  const digest = loadLearningDigest();
  const trends = loadSignalTrends();
  const failures = loadFailurePatterns();
  const parts: string[] = [];
  if (wisdom) parts.push(wisdom);
  if (relationship) parts.push(relationship);
  if (digest) parts.push(digest);
  if (trends) parts.push(trends);
  if (failures) parts.push(failures);
  if (work) parts.push(work.text);

  if (parts.length === 0) return "";

  const now = new Date();
  const time = `**Current time:** ${now.toISOString().slice(0, 19).replace("T", " ")} UTC`;

  return ["<system-reminder>", time, ...parts, "</system-reminder>"].join("\n");
}

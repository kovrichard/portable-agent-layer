/**
 * Shared context builders for session startup.
 * Used by LoadContext.ts (Claude Code) and the opencode plugin.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "./frontmatter";
import { readFailures, readLearnings } from "./learning-store";
import { loadOpinionContext } from "./opinions";
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
    const cwd = process.cwd();
    const allRecent = recentSessions(48);
    const projects = activeProjects();
    const stale = staleProjects(7);

    if (allRecent.length === 0 && projects.length === 0) return null;

    const lines: string[] = [];

    if (allRecent.length > 0) {
      lines.push("## Recent Work (last 48h)");
      for (const s of allRecent.slice(-10).reverse()) {
        const ago = formatAgo(s.ts);
        const here = s.cwd === cwd ? " *" : "";
        lines.push(`- [${s.status}] ${s.name} — ${ago}${here}`);
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
    const cwdSessions = allRecent.filter((s) => s.cwd === cwd);
    const last = cwdSessions.length > 0 ? cwdSessions[cwdSessions.length - 1] : null;
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
    signals: countSignals("ratings.jsonl"),
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
      `🔧 PAL setup ${done}/${STEP_ORDER.length} | ${counts.signals} signals`
    );
  } else {
    greeting.push(
      `✅ PAL ready | ${counts.telos} TELOS | ${counts.skills} skills | ${counts.signals} signals | ${counts.sessions} sessions`
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

/** Load recent session learning files as digest, with detail for current project */
export function loadLearningDigest(): string {
  try {
    const cwd = process.cwd();
    const entries = readLearnings(paths.sessionLearning(), 10);
    if (entries.length === 0) return "";

    const thisProject = entries.filter((e) => e.cwd === cwd).slice(0, 4);
    const other = entries.filter((e) => e.cwd !== cwd).slice(0, 3);

    if (thisProject.length === 0 && other.length === 0) return "";

    const lines: string[] = [];

    if (thisProject.length > 0) {
      lines.push("## This Project — Recent Sessions");
      for (const e of thisProject) {
        lines.push(`- **${e.title}**`);
        if (e.insights) lines.push(`  ${e.insights.split("\n")[0].slice(0, 150)}`);
      }
    }

    if (other.length > 0) {
      lines.push(thisProject.length > 0 ? "" : "", "## Other Recent Learnings");
      for (const e of other) lines.push(`- ${e.title}`);
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

/** Load 5 most recent failure contexts as an "avoid" list */
export function loadFailurePatterns(): string {
  try {
    const entries = readFailures(paths.failures(), 5);
    if (entries.length === 0) return "";

    const lines = entries.map((e) => {
      const label = e.rating ? `[${e.rating}/10]` : "";
      return `- ${label} ${e.context}`.trim();
    });

    return ["## Recent Failure Patterns (Avoid)", ...lines].join("\n");
  } catch {
    return "";
  }
}

/** Load recommendations from the most recent synthesis report */
export function loadSynthesisRecommendations(): string {
  try {
    const synthDir = paths.synthesis();
    if (!existsSync(synthDir)) return "";

    // Find most recent month directory
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

        // Extract recommendations section
        const recMatch = content.match(/## Recommendations\n\n([\s\S]*?)(?:\n##|\n$|$)/);
        if (!recMatch?.[1]?.trim()) continue;

        const recs = recMatch[1]
          .trim()
          .split("\n")
          .filter((l) => l.trim())
          .slice(0, 4);

        if (recs.length === 0) continue;

        const { meta } = parse<{
          period?: string;
          average_rating?: string;
        }>(content);
        const period = meta.period || "";
        const avgRating = meta.average_rating ? `${meta.average_rating}/10` : "";

        const header = [
          "## Pattern Synthesis",
          period ? `*${period} — ${avgRating}*` : "",
        ]
          .filter(Boolean)
          .join("\n");

        return [header, ...recs].join("\n");
      } catch {}
    }
    return "";
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
  const synthesis = loadSynthesisRecommendations();
  const opinions = loadOpinionContext();
  const parts: string[] = [];
  if (wisdom) parts.push(wisdom);
  if (opinions) parts.push(opinions);
  if (relationship) parts.push(relationship);
  if (digest) parts.push(digest);
  if (synthesis) parts.push(synthesis);
  if (trends) parts.push(trends);
  if (failures) parts.push(failures);
  if (work) parts.push(work.text);

  if (parts.length === 0) return "";

  const now = new Date();
  const time = `**Current time:** ${now.toISOString().slice(0, 19).replace("T", " ")} UTC`;

  return ["<system-reminder>", time, ...parts, "</system-reminder>"].join("\n");
}

/**
 * Shared context builders for session startup.
 * Used by LoadContext.ts (Claude Code) and the opencode plugin.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parse } from "./frontmatter";
import { readFailures, readLearnings } from "./learning-store";
import { loadOpinionContext } from "./opinions";
import { paths } from "./paths";
import { loadActiveProjectsContext } from "./projects";
import { loadRecentNotes } from "./relationship";
import { readSessionNames } from "./session-names";
import * as settings from "./settings";
import { isSetupComplete, readSetupState, remainingSteps, STEP_ORDER } from "./setup";
import { computeSignalTrends, formatTrends } from "./signal-trends";
import { readFramePrinciples } from "./wisdom";
import { readProjectHistory, readSessions, recentSessions } from "./work-tracking";

/** Load and concatenate loadAtStartup files */
function loadStartupFiles(): string {
  const files = settings.startupFiles();
  if (files.length === 0) return "";

  const home = homedir();
  const sections: string[] = [];

  for (const file of files) {
    const resolved = file.replace("~", home);
    if (!existsSync(resolved)) continue;
    try {
      const content = readFileSync(resolved, "utf-8").trim();
      if (content) sections.push(content);
    } catch {
      /* skip unreadable files */
    }
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
    const cwd = process.cwd();
    const allRecent = recentSessions(48);

    if (allRecent.length === 0) return null;

    const lines: string[] = [];

    lines.push("## Recent Work (last 48h)");
    for (const s of allRecent.slice(-10).reverse()) {
      const ago = formatAgo(s.ts);
      const here = s.cwd === cwd ? " *" : "";
      lines.push(`- [${s.status}] ${s.name} — ${ago}${here}`);
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
  const setupIncomplete = setupState && !isSetupComplete(setupState);

  const greeting: string[] = [];

  if (setupIncomplete) {
    const done = STEP_ORDER.length - remainingSteps(setupState).length;
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

    // This-project learnings are now in loadProjectHistoryContext(); only show cross-project here
    const other = entries.filter((e) => e.cwd !== cwd).slice(0, 5);

    if (other.length === 0) return "";

    const lines: string[] = [];

    lines.push("## Other Recent Learnings");
    for (const e of other) lines.push(`- ${e.title}`);

    return lines.join("\n");
  } catch {
    return "";
  }
}

/** Load self-model for session context injection */
export function loadSelfModel(): string {
  try {
    const p = resolve(paths.memory(), "self-model", "current.md");
    if (!existsSync(p)) return "";
    const content = readFileSync(p, "utf-8").trim();
    if (!content) return "";
    return content;
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
      const text = e.principle || e.context;
      return `- ${label} ${text}`.trim();
    });

    return ["## Lessons from Recent Failures — Apply These Now", ...lines].join("\n");
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

/** Load per-project session history for the current working directory */
export function loadProjectHistoryContext(): string {
  try {
    const cwd = process.cwd();
    const entries = readProjectHistory(cwd, 3);
    if (entries.length === 0) return "";

    const lines: string[] = ["## This Project — Session History"];
    for (const e of entries) {
      lines.push(`- **${e.title}** (${e.date})`);
      if (e.summary) lines.push(`  ${e.summary.split("\n")[0].slice(0, 150)}`);
    }

    return lines.join("\n");
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

/** Load session intelligence from compact synthesis state */
export function loadSessionIntelligence(): string {
  try {
    const p = resolve(paths.state(), "synthesis.json");
    if (!existsSync(p)) return "";
    const state = JSON.parse(readFileSync(p, "utf-8"));

    const lines: string[] = ["## Session Intelligence"];

    // Open Threads — project-specific first, then global
    if (state.threads?.length > 0) {
      const cwd = process.cwd();
      const here = state.threads.filter((t: { cwd?: string }) => t.cwd === cwd);
      const other = state.threads.filter((t: { cwd?: string }) => t.cwd !== cwd);

      if (here.length > 0) {
        lines.push("");
        lines.push(`**Open threads — this project (${here.length}):**`);
        for (const t of here) {
          lines.push(`- ${t.title} (opened ${t.opened})`);
          if (t.context) lines.push(`  ${t.context}`);
        }
        lines.push("→ These are directly relevant to your current work.");
      }
      // Cross-project threads intentionally omitted — they were noise in 90%+ of sessions.
      // To surface them on demand, add a `threads` slash-command or a flag in pal-settings.
      void other;
    }

    // Rating Trend
    if (state.ratings?.count > 0) {
      const r = state.ratings;
      lines.push("");
      lines.push(
        `**Rating trend:** ${r.avg}/10 avg (last 10: ${r.recentAvg}/10, ${r.trend}).${r.lowCount > 0 ? ` ${r.lowCount} low ratings.` : ""}`
      );
      if (r.trend === "declining") {
        lines.push(
          "→ Trend is declining. Be extra careful with assumptions. Confirm before acting."
        );
      } else if (r.trend === "improving") {
        lines.push("→ Trend is improving. Maintain current approach.");
      } else if (r.lowCount > 5) {
        lines.push(
          "→ Multiple low ratings. Slow down, verify before acting, ask when uncertain."
        );
      }
    }

    // Algorithm Performance
    if (state.algorithm?.reflectionCount > 0) {
      const a = state.algorithm;
      lines.push("");
      lines.push(
        `**Algorithm:** ${a.reflectionCount} reflections, ${a.passRate}% criteria pass rate, ${a.avgSentiment}/10 sentiment.`
      );
      if (a.passRate < 80) {
        lines.push(
          "→ Criteria pass rate is low. Invest more time in OBSERVE and PLAN phases."
        );
      }
      if (a.recentObservations?.length > 0) {
        const cwd = process.cwd();
        const relevant = a.recentObservations.filter(
          (o: { cwd?: string }) => !o.cwd || o.cwd === cwd
        );
        if (relevant.length > 0) {
          lines.push("Recent self-observations (this project):");
          for (const o of relevant) {
            lines.push(`- [${o.date}] ${o.task}: "${o.observation}"`);
          }
        }
      }
    }

    return lines.length > 1 ? lines.join("\n") : "";
  } catch {
    return "";
  }
}

/** Load handoff state for the current project */
export function loadHandoff(): string {
  try {
    const p = resolve(paths.state(), "last-handoff.json");
    if (!existsSync(p)) return "";
    const handoffs = JSON.parse(readFileSync(p, "utf-8"));
    const cwd = process.cwd();
    const entry = handoffs[cwd];
    if (!entry?.handoff || entry.status !== "in-progress") return "";

    const age = Date.now() - new Date(entry.timestamp).getTime();
    if (age > 7 * 24 * 60 * 60 * 1000) return ""; // stale after 7 days

    return [
      "## Pick Up Where You Left Off",
      `*Previous session: ${entry.title}*`,
      "",
      entry.handoff,
      "→ Continue this work or explicitly close it before starting something new.",
    ].join("\n");
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
  const startup = loadStartupFiles();
  const work = settings.isEnabled("activeWork") ? loadActiveWork() : null;
  const wisdom = settings.isEnabled("wisdom") ? loadWisdomContext() : "";
  const relationship = settings.isEnabled("relationship")
    ? loadRelationshipContext()
    : "";
  const digest = settings.isEnabled("learningDigest") ? loadLearningDigest() : "";
  const projectHistory = settings.isEnabled("projectHistory")
    ? loadProjectHistoryContext()
    : "";
  const activeProjects = settings.isEnabled("projects")
    ? loadActiveProjectsContext()
    : "";
  const trends = settings.isEnabled("signalTrends") ? loadSignalTrends() : "";
  const failures = settings.isEnabled("failurePatterns") ? loadFailurePatterns() : "";
  const synthesis = settings.isEnabled("synthesis") ? loadSynthesisRecommendations() : "";
  const opinions = settings.isEnabled("opinions") ? loadOpinionContext() : "";
  const selfModel = settings.isEnabled("selfModel") ? loadSelfModel() : "";
  const intelligence = settings.isEnabled("sessionIntelligence")
    ? loadSessionIntelligence()
    : "";
  const handoff = settings.isEnabled("handoff") ? loadHandoff() : "";
  const parts: string[] = [];
  if (startup) parts.push(startup);
  if (handoff) parts.push(handoff);
  if (selfModel) parts.push(selfModel);
  if (wisdom) parts.push(wisdom);
  if (opinions) parts.push(opinions);
  if (intelligence) parts.push(intelligence);
  if (relationship) parts.push(relationship);
  if (activeProjects) parts.push(activeProjects);
  if (projectHistory) parts.push(projectHistory);
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

/**
 * Shared context builders for session startup.
 * Used by LoadContext.ts (Claude Code) and the opencode plugin.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { readLearnings } from "./learning-store";
import { loadOpinionContext } from "./opinions";
import { paths } from "./paths";
import { loadActiveProjectsContext } from "./projects";
import { loadRecentNotes } from "./relationship";
import { loadFailurePatterns, loadSynthesisRecommendations } from "./semi-static";
import { readSessionNames } from "./session-names";
import * as settings from "./settings";
import { isSetupComplete, readSetupState, remainingSteps, STEP_ORDER } from "./setup";
import { computeSignalTrends, formatTrends } from "./signal-trends";
import { readFramePrinciples } from "./wisdom";
import { readProjectHistory, readSessions } from "./work-tracking";

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

/**
 * Filter raw relationship note lines:
 * - O entries: stripped (loaded natively via digest)
 * - HTML comments: stripped, but cwd is extracted from session comments
 * - Session entries: kept only if block cwd matches current project (or legacy with no cwd)
 * - W entries and structural lines: always kept
 */
function filterRelationshipNotes(notes: string, cwd: string): string {
  const lines = notes.split("\n");
  const out: string[] = [];
  let blockCwd: string | null = null;

  for (const line of lines) {
    if (/^## \d{2}:\d{2}/.test(line)) {
      blockCwd = null;
      out.push(line);
      continue;
    }
    const cwdMatch = line.match(/<!--.*cwd:(\S+)/);
    if (cwdMatch) {
      blockCwd = cwdMatch[1];
      continue;
    }
    if (/^\s*<!--/.test(line)) continue;
    if (/^\s*- O\(/.test(line)) continue;
    if (/^\s*- Session:/.test(line)) {
      if (blockCwd === null || blockCwd === cwd) out.push(line);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Load recent relationship notes (today + yesterday), scoped to current project */
export function loadRelationshipContext(): string {
  try {
    const notes = loadRecentNotes(2);
    if (!notes) return "";
    const filtered = filterRelationshipNotes(notes, process.cwd());
    return capSection(`## Recent Interaction Notes\n${filtered}`, 1500);
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

    return lines.length > 1 ? capSection(lines.join("\n"), 2000) : "";
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

/** Truncate text to maxChars at the last complete line boundary */
function capSection(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const lines = text.split("\n");
  const kept: string[] = [];
  let total = 0;
  for (const line of lines) {
    const next = total + line.length + 1;
    if (next > maxChars) break;
    kept.push(line);
    total = next;
  }
  return kept.join("\n");
}

/** Agent targets — determines which context sections are skipped due to native loading. */
export type AgentTarget = "claude" | "opencode" | "cursor" | "copilot";

/**
 * Build the <system-reminder> content for the AI.
 *
 * Static context (TELOS, setup prompt) lives in AGENTS.md / CLAUDE.md and is
 * loaded natively by Claude Code / opencode. This injects dynamic context only —
 * things that change per-session and can't live in a static file.
 *
 * opts.agent — agent target; Claude Code skips semi-static sections (self-model,
 * wisdom, opinions) that load natively via @imports in CLAUDE.md.
 */
export function buildSystemReminder(opts: { agent?: AgentTarget } = {}): string {
  // Semi-static sections loaded natively via @imports (Claude Code) or
  // instructions[] (opencode). Skip them from hook output for those agents.
  const skipSemiStatic =
    opts.agent === "claude" ||
    opts.agent === "opencode" ||
    opts.agent === "cursor" ||
    opts.agent === "copilot";

  const startup = loadStartupFiles();
  const wisdom =
    !skipSemiStatic && settings.isEnabled("wisdom") ? loadWisdomContext() : "";
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
  const failures =
    settings.isEnabled("failurePatterns") && !skipSemiStatic ? loadFailurePatterns() : "";
  const synthesis =
    settings.isEnabled("synthesis") && !skipSemiStatic
      ? loadSynthesisRecommendations()
      : "";
  const opinions =
    !skipSemiStatic && settings.isEnabled("opinions") ? loadOpinionContext() : "";
  const selfModel =
    !skipSemiStatic && settings.isEnabled("selfModel") ? loadSelfModel() : "";
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
  if (parts.length === 0) return "";

  const now = new Date();
  const time = `**Current time:** ${now.toISOString().slice(0, 19).replace("T", " ")} UTC`;

  return ["<system-reminder>", time, ...parts, "</system-reminder>"].join("\n");
}

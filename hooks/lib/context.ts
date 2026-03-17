/**
 * Shared context builders for session startup.
 * Used by LoadContext.ts (Claude Code) and the opencode plugin.
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { paths } from "./paths";
import { readSetupState, buildSetupPrompt, remainingSteps, STEP_ORDER } from "./setup";
import { readFramePrinciples } from "./wisdom";
import { loadRecentNotes } from "./relationship";
import { computeSignalTrends, formatTrends } from "./signal-trends";

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
          !l.startsWith("#") &&
          !l.startsWith("<!--") &&
          !l.startsWith("-->") &&
          l.trim()
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

/** Load previous session context from current-work.json */
export function loadActiveWork(): { text: string; summary: string | null } | null {
  const workFile = resolve(paths.state(), "current-work.json");
  if (!existsSync(workFile)) return null;

  try {
    const data = JSON.parse(readFileSync(workFile, "utf-8"));
    const text = [
      "## Previous Session Context",
      `**Last active:** ${data.ts}`,
      `**Working directory:** ${data.cwd}`,
      `**Last request:** ${data.last_user}`,
    ].join("\n");

    const lastUser = data.last_user?.slice(0, 60) || null;

    return { text, summary: lastUser ? `"${lastUser}"` : null };
  } catch {
    return null;
  }
}

/** Build the visible greeting line for stderr */
export function buildGreeting(): string[] {
  const signalCount =
    countSignals("ratings.jsonl") + countSignals("learnings.jsonl");
  const work = loadActiveWork();
  const setupState = readSetupState();
  const setupPrompt = setupState ? buildSetupPrompt(setupState) : null;

  const greeting: string[] = [];

  if (setupPrompt) {
    const done =
      STEP_ORDER.length -
      (setupState ? remainingSteps(setupState).length : 0);
    greeting.push(
      `🔧 PAI setup ${done}/${STEP_ORDER.length} | ${signalCount} signals`
    );
  } else {
    const telosCount = setupState
      ? STEP_ORDER.filter((k) => setupState.steps[k]?.done).length
      : 0;
    greeting.push(
      `✅ PAI ready | ${telosCount} TELOS files | ${signalCount} signals`
    );
  }

  if (work?.summary) {
    greeting.push(`📋 Previous: ${work.summary}`);
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
      } catch { /* skip */ }
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

    const slugs: string[] = [];
    for (const month of readdirSync(failuresDir).sort().reverse()) {
      const monthPath = resolve(failuresDir, month);
      try {
        const dirs = readdirSync(monthPath).sort().reverse();
        for (const dir of dirs) {
          // dir name is {timestamp}_{slug} — extract slug after first underscore group
          const slug = dir.replace(/^\d{8}-\d{6}_/, "");
          slugs.push(slug);
          if (slugs.length >= 5) break;
        }
      } catch { /* skip */ }
      if (slugs.length >= 5) break;
    }

    if (slugs.length === 0) return "";
    return ["## Recent Failure Patterns (Avoid)", ...slugs.map((s) => `- ${s}`)].join("\n");
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

/** Build the <system-reminder> content for the AI */
export function buildSystemReminder(): string {
  const telos = loadTelos();
  const work = loadActiveWork();
  const wisdom = loadWisdomContext();
  const relationship = loadRelationshipContext();
  const digest = loadLearningDigest();
  const trends = loadSignalTrends();
  const failures = loadFailurePatterns();
  const setupState = readSetupState();
  const setupPrompt = setupState ? buildSetupPrompt(setupState) : null;

  const parts = ["<system-reminder>", "# Personal Context (TELOS)"];

  if (setupPrompt) parts.push(setupPrompt);
  if (telos) parts.push(telos);
  if (wisdom) parts.push("", wisdom);
  if (relationship) parts.push("", relationship);
  if (digest) parts.push("", digest);
  if (trends) parts.push("", trends);
  if (failures) parts.push("", failures);
  if (work) parts.push("", work.text);

  parts.push("</system-reminder>");
  return parts.join("\n");
}

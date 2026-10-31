/**
 * Shared context builders for session startup.
 * Used by LoadContext.ts (Claude Code) and the opencode plugin.
 */

import { existsSync, readFileSync } from "node:fs";
import { opinionsContext } from "./adaptation-rules";
import type { AgentName } from "./agent-registry";
import { dueNudgeSections } from "./daily-nudge";
import { toPath } from "./paths";
import { loadProgressTreeContext } from "./progress-tree-context";
import { loadActiveProjectsContext } from "./projects";
import { loadSteeringRules } from "./semi-static";
import { sessionDir } from "./session-dir";
import * as settings from "./settings";
import { lastSessionTitle } from "./work-tracking";

/** Load and concatenate loadAtStartup files */
function loadStartupFiles(): string {
  const files = settings.startupFiles();
  if (files.length === 0) return "";

  const sections: string[] = [];

  for (const file of files) {
    const resolved = toPath(file);
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

/**
 * Agent targets — determines which context sections are skipped due to native loading.
 * Codex has no native include for them, so its reminder carries them.
 */
export type AgentTarget = Extract<
  AgentName,
  "claude" | "opencode" | "cursor" | "copilot" | "codex"
>;

/**
 * Build the <system-reminder> content for the AI.
 *
 * Static context (TELOS, setup prompt) lives in AGENTS.md / CLAUDE.md and is
 * loaded natively by Claude Code / opencode. This injects dynamic context only —
 * things that change per-session and can't live in a static file.
 *
 * opts.agent — agent target; Claude Code skips semi-static sections (opinions,
 * steering) that load natively via @imports in CLAUDE.md.
 */
export function buildSystemReminder(
  opts: { agent?: AgentTarget; sessionId?: string } = {}
): string {
  // Semi-static sections loaded natively via @imports (Claude Code) or
  // instructions[] (opencode). Skip them from hook output for those agents.
  const skipSemiStatic =
    opts.agent === "claude" ||
    opts.agent === "opencode" ||
    opts.agent === "cursor" ||
    opts.agent === "copilot";

  const startup = loadStartupFiles();
  const activeProjects = settings.isEnabled("projects")
    ? loadActiveProjectsContext(sessionDir(), lastSessionTitle)
    : "";
  const opinions =
    !skipSemiStatic && settings.isEnabled("opinions") ? opinionsContext() : "";
  const steering = skipSemiStatic ? "" : loadSteeringRules();
  const progressTree = loadProgressTreeContext(sessionDir(), opts.sessionId);
  const dueNudges = opts.agent === "cursor" ? dueNudgeSections() : [];
  const parts: string[] = [];
  if (startup) parts.push(startup);
  if (progressTree) parts.push(progressTree);
  parts.push(...dueNudges);
  if (opinions) parts.push(opinions);
  if (activeProjects) parts.push(activeProjects);
  if (steering) parts.push(steering);
  if (parts.length === 0) return "";

  const now = new Date();
  const time = `**Current time:** ${now.toISOString().slice(0, 19).replace("T", " ")} UTC`;

  return ["<system-reminder>", time, ...parts, "</system-reminder>"].join("\n");
}

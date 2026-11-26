/**
 * Shared context builders for session startup.
 * Used by LoadContext.ts (Claude Code) and the opencode plugin.
 */

import { existsSync, readFileSync } from "node:fs";
import type { AgentName } from "../core/agent-registry";
import { toPath } from "../core/paths";
import { sessionDir } from "../core/session-dir";
import * as settings from "../core/settings";
import { opinionsContext } from "../opinions/adaptation-rules";
import { loadProgressTreeContext } from "../progress/progress-tree-context";
import { loadActiveProjectsContext } from "../progress/projects-context";
import { lastSessionTitle } from "../progress/work-tracking";
import { readHealthNotice } from "../usage/health-cache";
import { dueNudgeSections } from "./daily-nudge";
import { loadSteeringRules } from "./semi-static";

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

function healthNoticeSection(): string {
  const notice = readHealthNotice();

  return notice
    ? `## PAL notice\n${notice}. Tell the user once in this session, and point them to \`pal cli doctor\` for what to run and why.`
    : "";
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
  const notice = healthNoticeSection();
  const parts: string[] = [];

  if (notice) parts.push(notice);

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

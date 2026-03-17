/**
 * Hook: SessionStart — Loads TELOS context + active work state.
 * Outputs a <system-reminder> so the AI has your identity/goals in context.
 * Also prints a visible startup greeting with stats.
 *
 * If first-run setup is incomplete, injects setup wizard instructions.
 *
 * This is the most important hook — it's what makes the AI "know you".
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { paths } from "./lib/paths";
import { readSetupState, buildSetupPrompt, remainingSteps, STEP_ORDER } from "./lib/setup";

function loadTelos(): string {
  const telosDir = paths.telos();
  if (!existsSync(telosDir)) return "";

  const files = readdirSync(telosDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const sections: string[] = [];

  for (const file of files) {
    const content = readFileSync(resolve(telosDir, file), "utf-8").trim();
    // Skip empty templates (only have a heading and comment)
    if (content.split("\n").filter((l) => !l.startsWith("#") && !l.startsWith("<!--") && !l.startsWith("-->") && l.trim()).length === 0) {
      continue;
    }
    sections.push(content);
  }

  return sections.join("\n\n---\n\n");
}

function countSignals(filename: string): number {
  const filepath = resolve(paths.signals(), filename);
  if (!existsSync(filepath)) return 0;
  try {
    const content = readFileSync(filepath, "utf-8").trim();
    return content ? content.split("\n").length : 0;
  } catch {
    return 0;
  }
}

function loadActiveWork(): { text: string; summary: string | null } | null {
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

function timeAgo(isoDate: string): string {
  try {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "unknown";
  }
}

// Main
const telos = loadTelos();
const signalCount = countSignals("ratings.jsonl") + countSignals("learnings.jsonl");
const work = loadActiveWork();
const setupState = readSetupState();
const setupPrompt = setupState ? buildSetupPrompt(setupState) : null;

// --- Visible greeting to stderr ---
const greeting: string[] = [];

if (setupPrompt) {
  const done = STEP_ORDER.length - (setupState ? remainingSteps(setupState).length : 0);
  greeting.push(`🔧 PAI setup ${done}/${STEP_ORDER.length} | ${signalCount} signals`);
} else {
  // Count TELOS files that have real content (files with setup step marked done)
  const telosCount = setupState
    ? STEP_ORDER.filter((k) => setupState.steps[k]?.done).length
    : 0;
  greeting.push(`✅ PAI ready | ${telosCount} TELOS files | ${signalCount} signals`);
}

if (work?.summary) {
  greeting.push(`📋 Previous: ${work.summary}`);
}

process.stderr.write(greeting.join("\n") + "\n");

// --- System-reminder to stdout ---
const parts = ["<system-reminder>", "# Personal Context (TELOS)"];

if (setupPrompt) {
  parts.push(setupPrompt);
}

if (telos) parts.push(telos);
if (work) parts.push("", work.text);

parts.push("</system-reminder>");
console.log(parts.join("\n"));

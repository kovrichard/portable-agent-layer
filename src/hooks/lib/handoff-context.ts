import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { paths } from "./paths";

interface HandoffEntry {
  title?: string;
  handoff?: string;
  status?: string;
  timestamp?: string;
}

const HANDOFF_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const ELSEWHERE_MAX_CHARS = 300;

function readHandoffs(): Record<string, HandoffEntry> {
  const p = resolve(paths.state(), "last-handoff.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function isFresh(entry: HandoffEntry, now: number): boolean {
  if (!entry.handoff || !entry.timestamp) return false;
  return now - new Date(entry.timestamp).getTime() <= HANDOFF_STALE_MS;
}

function isScratchDir(dir: string): boolean {
  return dir.startsWith(tmpdir());
}

function trimAtWord(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
}

function formatAgo(timestamp: string, now: number): string {
  const minutes = Math.floor((now - new Date(timestamp).getTime()) / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function hereSection(entry: HandoffEntry | undefined, now: number): string {
  if (!entry || entry.status !== "in-progress" || !isFresh(entry, now)) return "";
  return [
    "## Pick Up Where You Left Off",
    `*Previous session: ${entry.title}*`,
    "",
    entry.handoff,
    "→ Continue this work or explicitly close it before starting something new.",
  ].join("\n");
}

function latestElsewhere(
  handoffs: Record<string, HandoffEntry>,
  here: string,
  now: number
): [string, HandoffEntry] | undefined {
  return Object.entries(handoffs)
    .filter(([dir, entry]) => dir !== here && !isScratchDir(dir) && isFresh(entry, now))
    .sort(([, a], [, b]) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))[0];
}

function elsewhereSection(
  handoffs: Record<string, HandoffEntry>,
  here: string,
  now: number
): string {
  const latest = latestElsewhere(handoffs, here, now);
  if (!latest) return "";
  const [dir, entry] = latest;
  const hereEntry = handoffs[here];
  if (hereEntry?.timestamp && hereEntry.timestamp > (entry.timestamp ?? "")) return "";
  return [
    "## Last Conversation Elsewhere",
    `*${dir} · ${formatAgo(entry.timestamp ?? "", now)} · may be unrelated: ${entry.title}*`,
    trimAtWord(entry.handoff ?? "", ELSEWHERE_MAX_CHARS),
  ].join("\n");
}

/**
 * This folder's handoff comes first and in full, since it is what a session
 * started here usually continues. The latest conversation from any other
 * folder follows in brief, only when it is newer than this folder's.
 */
export function loadHandoffContext(here: string, now: number = Date.now()): string {
  const handoffs = readHandoffs();
  return [hereSection(handoffs[here], now), elsewhereSection(handoffs, here, now)]
    .filter(Boolean)
    .join("\n\n");
}

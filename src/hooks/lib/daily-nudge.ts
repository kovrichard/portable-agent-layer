import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadReflectNudge } from "../handlers/reflect-trigger";
import { loadAlgorithmReviewNudge } from "./algorithm-review";
import { loadAnalyzeNudge } from "./analyze-nudge";
import { ensureDir, paths } from "./paths";
import { loadReactionAuditNudge } from "./reaction-audit";
import { localDay } from "./wall-clock";

type ShownOn = Record<string, string>;

interface DueNudge {
  key: string;
  command: string;
  load: () => string;
}

const DUE_NUDGES: DueNudge[] = [
  {
    key: "algorithm-review",
    command: "/algorithm-update",
    load: loadAlgorithmReviewNudge,
  },
  { key: "reaction-audit", command: "/reaction-audit", load: loadReactionAuditNudge },
  { key: "reflect", command: "/pal-reflect", load: loadReflectNudge },
  { key: "analyze", command: "/pal-analyze", load: loadAnalyzeNudge },
];

function shownPath(): string {
  return resolve(ensureDir(paths.state()), "nudges-shown.json");
}

function readShownOn(): ShownOn {
  try {
    return JSON.parse(readFileSync(shownPath(), "utf-8"));
  } catch {
    return {};
  }
}

/**
 * A reminder asks the user for something, so it stays until a reply has passed
 * it on, then rests for the rest of the day.
 */
export function pendingToday(
  key: string,
  reminder: string,
  now: Date = new Date()
): string {
  if (!reminder) return "";
  return readShownOn()[key] === localDay(now) ? "" : reminder;
}

export function acknowledgeMentioned(reply: string, now: Date = new Date()): void {
  const mentioned = DUE_NUDGES.filter((nudge) => reply.includes(nudge.command));
  if (!mentioned.length) return;
  const today = localDay(now);
  const shownOn = readShownOn();
  for (const nudge of mentioned) shownOn[nudge.key] = today;
  writeFileSync(shownPath(), JSON.stringify(shownOn), "utf-8");
}

export function dueNudgeSections(now: Date = new Date()): string[] {
  return DUE_NUDGES.map((nudge) => pendingToday(nudge.key, nudge.load(), now)).filter(
    Boolean
  );
}

export function dueNudgeReminder(now: Date = new Date()): string | null {
  const sections = dueNudgeSections(now);
  if (!sections.length) return null;
  return [
    "Tell the user in one line at the end of this reply that the following is due, naming its command. This comes back every turn until a reply does.",
    ...sections,
  ].join("\n\n");
}

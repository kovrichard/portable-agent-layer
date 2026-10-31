/**
 * What the hooks do while a run is on: refuse tool calls past the deadline,
 * refuse questions and delegation while unattended, keep an unattended agent
 * from stopping with work left, and say where the run stands.
 */

import { resolve } from "node:path";
import { scopeOf } from "./progress-tree";
import {
  clearRun,
  describeRun,
  isOver,
  minutesLeft,
  type Run,
  readRun,
  untilLabel,
  writeRun,
} from "./run-mode";
import { runsOnlyPalCli } from "./security";

export interface RunToolCall {
  tool: string;
  command?: string;
  filePath?: string;
}

const ASK_TOOLS = new Set([
  "askuserquestion",
  "ask_user",
  "askuser",
  "ask_followup_question",
  "request_user_input",
]);
const DELEGATE_TOOLS = new Set(["agent", "task", "workflow", "spawn_agent"]);
export const MAX_STOP_BLOCKS = 20;

function runIn(cwd: string, now: Date): Run | null {
  return readRun(scopeOf(cwd), now);
}

function writesTheReport(run: Run, call: RunToolCall, cwd: string): boolean {
  if (!run.report || !call.filePath) return false;
  return resolve(cwd, call.filePath) === resolve(cwd, run.report);
}

function finishesTheRun(run: Run, call: RunToolCall, cwd: string): boolean {
  return (
    (call.command !== undefined && runsOnlyPalCli(call.command)) ||
    writesTheReport(run, call, cwd)
  );
}

function closeCommand(run: Run): string {
  return run.kind === "unattended" ? "pal cli unattended done" : "pal cli timebox end";
}

function deadlineMessage(run: Run): string {
  const task = run.task ? ` (${run.task})` : "";
  const report = run.report ? ` Finish the report at ${run.report}.` : "";
  return `Time box ended at ${untilLabel(run)}${task}. Stop working now: report what you found, what is unfinished and what comes next.${report} Only \`pal cli\` and edits to the report still run. Then run \`${closeCommand(run)}\`.`;
}

function unattendedRefusal(tool: string): string | null {
  const name = tool.toLowerCase();
  if (ASK_TOOLS.has(name))
    return "Unattended run: nobody can answer. Decide, log it with `pal cli unattended log`, and put the question in the report.";
  if (DELEGATE_TOOLS.has(name))
    return "Unattended run: one process at a time, so no subagents or workflows. Do the step yourself.";
  return null;
}

/** Why this call may not run under the scope's run, or null to let it through. */
export function runModeRefusal(
  call: RunToolCall,
  cwd: string,
  now: Date = new Date()
): string | null {
  const run = runIn(cwd, now);
  if (!run) return null;
  if (isOver(run, now))
    return finishesTheRun(run, call, cwd) ? null : deadlineMessage(run);
  return run.kind === "unattended" ? unattendedRefusal(call.tool) : null;
}

function reportPlace(run: Run): string {
  return run.report ? ` at ${run.report}` : "";
}

function stopMessage(run: Run, now: Date): string {
  if (isOver(run, now))
    return `Unattended run ended at ${untilLabel(run)}. Finalise the report${reportPlace(run)}, then run \`pal cli unattended done\`.`;
  return `Unattended until ${untilLabel(run)} (${minutesLeft(run, now)} min left): the user is not here to take a reply. Log the step you finished, then take the next approved task, or a fallback when none is left. Keep the draft report current. When every task and fallback is finished and the report is written, run \`pal cli unattended done\`.`;
}

/** The reason to keep an unattended agent going, or null to let it stop. Counts each block. */
export function unattendedStopReason(cwd: string, now: Date = new Date()): string | null {
  const run = runIn(cwd, now);
  if (!run || run.kind !== "unattended" || run.done) return null;
  if (run.stopBlocks >= MAX_STOP_BLOCKS) return null;
  writeRun({ ...run, stopBlocks: run.stopBlocks + 1 });
  return stopMessage(run, now);
}

function taskSuffix(run: Run): string {
  return run.task ? `: ${run.task}` : "";
}

function promptLine(run: Run, now: Date): string {
  if (run.kind === "timebox")
    return `Time box until ${untilLabel(run)}, ${minutesLeft(run, now)} min left${taskSuffix(run)}. Stop and report at the deadline.`;
  return `Unattended run until ${untilLabel(run)}, but the user just wrote: answer them. If they are back, run \`pal cli unattended end\`.`;
}

/** The per-prompt line for the scope's run. A user prompt after the deadline means the run is over, so it is cleared. */
export function runModePromptLine(cwd: string, now: Date = new Date()): string | null {
  const run = runIn(cwd, now);
  if (!run) return null;
  if (isOver(run, now)) {
    clearRun(run.scope);
    return null;
  }
  return `<system-reminder>${promptLine(run, now)}</system-reminder>`;
}

/** The run in full, for the context restored after a compaction. */
export function runModeRecall(cwd: string, now: Date = new Date()): string | null {
  const run = runIn(cwd, now);
  if (!run) return null;
  return `<system-reminder>\n## Active run — re-read before doing anything else\n${describeRun(run, now)}\n</system-reminder>`;
}

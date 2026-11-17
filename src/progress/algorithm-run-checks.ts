/**
 * The shadow checks on one ALGORITHM turn: what kind of run it is, read from its tool
 * mix, and which checks would have nudged it. Pure: nothing here is shown or blocks.
 */

import { replyAsks } from "../opinions/interaction";
import { lastPhase, PHASES, phasesIn } from "./algorithm-run-facts";
import type { ToolCall, TurnTools } from "./algorithm-run-tools";

export type RunType = "code" | "research" | "explain";

type RunCheck = "no-reflection" | "no-check-after-edit" | "uncited-fetch";

type Exemption = "no-tool-record" | "stopped-at-plan" | "asked-user";

export interface RunChecks {
  runType: RunType[];
  wouldNudge: RunCheck[];
  exempt: Exemption | null;
}

export const CHECK_COMMANDS = [
  "bun test",
  "bun run test",
  "bun run gates",
  "bun run type-check",
  "bun run check",
  "tsc",
  "npm test",
  "pytest",
  "cargo test",
  "go test",
] as const;

/** Research when web calls are more than this share of the turn's substantive calls. */
export const RESEARCH_SHARE = 0.5;

const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);
const WEB_TOOLS = new Set(["WebSearch", "WebFetch"]);
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);
const COMMAND_TOOLS = new Set(["Bash", "PowerShell"]);
const BOOKKEEPING_TOOLS = new Set([
  "TodoWrite",
  "ToolSearch",
  "Skill",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
]);
const COMMIT_RE = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/;
const REFLECT_RE = /\bpal\s+cli\s+algorithm-reflect\b/;
const BOOKKEEPING_COMMAND_RE = /^\s*pal\s+cli\s+(?:progress|algorithm-reflect)\b/;
const URL_RE = /https?:\/\/[^\s<>"'`()[\]]+/g;
const URL_TRAILER_RE = /[.,;:!?*_~/]+$/;
const PLANNING_PHASES = new Set<string>(["OBSERVE", "PLAN"]);
const EXECUTE_INDEX = PHASES.indexOf("EXECUTE");

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CHECK_COMMAND_RE = new RegExp(
  String.raw`(?:^|[\s;&|(])(?:${CHECK_COMMANDS.map(escaped).join("|")})(?=$|[\s;&|)])`
);

function commandOf(call: ToolCall): string {
  const command = call.input.command;

  return COMMAND_TOOLS.has(call.name) && typeof command === "string" ? command : "";
}

function isEdit(call: ToolCall): boolean {
  return EDIT_TOOLS.has(call.name);
}

function isCommit(call: ToolCall): boolean {
  return COMMIT_RE.test(commandOf(call));
}

function isWebAgent(subagentType: unknown): boolean {
  return (
    typeof subagentType === "string" &&
    (subagentType === "web-fetch" || subagentType.endsWith("researcher"))
  );
}

function isWeb(call: ToolCall): boolean {
  if (WEB_TOOLS.has(call.name)) return true;

  return SUBAGENT_TOOLS.has(call.name) && isWebAgent(call.input.subagent_type);
}

function isBookkeeping(call: ToolCall): boolean {
  return BOOKKEEPING_TOOLS.has(call.name) || BOOKKEEPING_COMMAND_RE.test(commandOf(call));
}

function isCheck(call: ToolCall): boolean {
  return CHECK_COMMAND_RE.test(commandOf(call));
}

function isReflection(call: ToolCall): boolean {
  return REFLECT_RE.test(commandOf(call));
}

function changedCode(calls: ToolCall[]): boolean {
  return calls.some((call) => isEdit(call) || isCommit(call));
}

function mostlyWeb(calls: ToolCall[]): boolean {
  const web = calls.filter(isWeb).length;
  const substantive = calls.filter((call) => !isBookkeeping(call)).length;

  return web > 0 && web / substantive > RESEARCH_SHARE;
}

export function runTypesOf(calls: ToolCall[]): RunType[] {
  const types: RunType[] = [
    ...(changedCode(calls) ? (["code"] as const) : []),
    ...(mostlyWeb(calls) ? (["research"] as const) : []),
  ];

  return types.length ? types : ["explain"];
}

/** Only the calls after the last file edit can check it; a turn that only committed is checked whole. */
function checkedAfterLastEdit(calls: ToolCall[]): boolean {
  const lastEdit = calls.findLastIndex(isEdit);

  return calls.slice(lastEdit + 1).some(isCheck);
}

function reachedExecute(types: RunType[], phases: string[]): boolean {
  if (!types.includes("explain")) return true;
  const last = lastPhase(phases);

  return (
    last !== null && PHASES.indexOf(last as (typeof PHASES)[number]) >= EXECUTE_INDEX
  );
}

function bareUrl(url: string): string {
  return url.replace(URL_TRAILER_RE, "");
}

export function citedUrls(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(URL_RE), (m) => bareUrl(m[0])))];
}

function seenByTools(tools: TurnTools): string {
  return [
    ...tools.calls.map((call) => JSON.stringify(call.input)),
    ...tools.outputs,
  ].join("\n");
}

export function uncitedUrls(reply: string, tools: TurnTools): string[] {
  const seen = seenByTools(tools);

  return citedUrls(reply).filter((url) => !seen.includes(url));
}

function failedChecks(
  types: RunType[],
  phases: string[],
  reply: string,
  tools: TurnTools
): RunCheck[] {
  const { calls } = tools;
  const failed: [RunCheck, boolean][] = [
    ["no-reflection", reachedExecute(types, phases) && !calls.some(isReflection)],
    ["no-check-after-edit", types.includes("code") && !checkedAfterLastEdit(calls)],
    ["uncited-fetch", types.includes("research") && uncitedUrls(reply, tools).length > 0],
  ];

  return failed.flatMap(([check, fails]) => (fails ? [check] : []));
}

function exemption(phases: string[], reply: string, calls: ToolCall[]): Exemption | null {
  const last = lastPhase(phases);
  if (last && PLANNING_PHASES.has(last) && !changedCode(calls)) return "stopped-at-plan";

  return replyAsks(reply) ? "asked-user" : null;
}

/** The turn's run type and failing checks; an exempt turn has a run type but no verdict. */
export function runChecks(texts: string[], tools: TurnTools | null): RunChecks {
  if (!tools) return { runType: [], wouldNudge: [], exempt: "no-tool-record" };
  const phases = phasesIn(texts);
  const reply = texts.at(-1) ?? "";
  const runType = runTypesOf(tools.calls);
  const exempt = exemption(phases, reply, tools.calls);
  const wouldNudge = exempt ? [] : failedChecks(runType, phases, reply, tools);

  return { runType, wouldNudge, exempt };
}

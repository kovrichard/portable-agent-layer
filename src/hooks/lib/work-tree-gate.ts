/**
 * The end-of-turn check that keeps the work tree true: a turn that produced
 * something (a commit, a branch, a PR, a published artifact) and recorded
 * nothing in the tree is sent back once to record it.
 */

import { callsThisTurn, commandsThisTurn, promptThisTurn } from "./claim-check";
import { alreadySentBack, transcriptLines } from "./claim-log";
import { type DecisionLabel, decisionRequest, parseDecision } from "./decision-label";
import { hookFinalReply } from "./hook-turn";
import { inference } from "./inference";
import { sessionDir } from "./session-dir";
import { isOptedIn } from "./settings";
import type { StopTurnPayload } from "./stop";
import { readTree, scopeOf } from "./work-tree";
import { attachGitProgress } from "./work-tree-git";
import { renderPromptLine } from "./work-tree-render";

const RECORDS_WORK_RE = /\bpal\s+cli\s+work\b/;
const RECORDS_DECISION_RE = /\bpal\s+cli\s+work\s+decide\b/;

const PRODUCERS: { what: string; re: RegExp }[] = [
  { what: "committed", re: /\bgit\s+commit\b/ },
  { what: "made a branch", re: /\bgit\s+(?:checkout\s+-b|switch\s+-c|branch\s+(?!-)\S)/ },
  { what: "opened a PR", re: /\bgh\s+pr\s+create\b/ },
];

const ARTIFACT_TOOLS: ReadonlySet<string> = new Set(["Artifact"]);
const NON_PUBLISH_ACTION_RE = /"action":"(?!publish")/;

function producedThisTurn(commands: string[], lines: string[]): string[] {
  const produced = PRODUCERS.filter((p) => commands.some((c) => p.re.test(c))).map(
    (p) => p.what
  );
  const artifacts = callsThisTurn(lines, ARTIFACT_TOOLS) ?? [];
  if (artifacts.some((call) => !NON_PUBLISH_ACTION_RE.test(call)))
    produced.push("published an artifact");
  return produced;
}

function whereWorkStands(scope: string): string {
  return renderPromptLine(readTree(scope), false) ?? "Work: nothing recorded yet";
}

function sendBackReason(produced: string[], scope: string): string {
  const where = whereWorkStands(scope);
  return [
    `This turn ${produced.join(", ")} but recorded nothing in the work tree (${where}).`,
    'Record where the work stands with `pal cli work stopped "…"`, plus `decide` or `attach` where they fit;',
    'if no node fits, open one first with `pal cli work open "…"` (`--root` for unrelated work).',
  ].join(" ");
}

export function workTreeSendBack(
  payload: StopTurnPayload,
  lines: string[],
  cwd: string
): string | null {
  if (!isOptedIn("workTree") || !isOptedIn("workTreeGate")) return null;
  if (alreadySentBack(payload)) return null;
  const commands = commandsThisTurn(lines);
  if (commands === null || commands.some((c) => RECORDS_WORK_RE.test(c))) return null;
  const produced = producedThisTurn(commands, lines);
  return produced.length > 0 ? sendBackReason(produced, scopeOf(cwd)) : null;
}

type LabelDecision = (message: string, reply: string) => Promise<DecisionLabel | null>;

async function labelWithInference(message: string, reply: string) {
  const result = await inference(decisionRequest(message, reply));
  return result.success ? parseDecision(result.output) : null;
}

function decisionReason(what: string, scope: string): string {
  return [
    `This turn settled a decision (${what}) but recorded none in the work tree (${whereWorkStands(scope)}).`,
    'Record it with `pal cli work decide "…"`; if no node fits, open one first with `pal cli work open "…"`.',
  ].join(" ");
}

export async function decisionSendBack(
  payload: StopTurnPayload,
  lines: string[],
  cwd: string,
  label: LabelDecision = labelWithInference
): Promise<string | null> {
  if (!isOptedIn("workTree") || !isOptedIn("workTreeDecisionGate")) return null;
  if (alreadySentBack(payload)) return null;
  const commands = commandsThisTurn(lines);
  if (commands === null || commands.some((c) => RECORDS_DECISION_RE.test(c))) return null;
  const message = promptThisTurn(lines);
  const reply = hookFinalReply(payload);
  if (!message || !reply) return null;
  const decided = await label(message, reply);
  return decided?.decision ? decisionReason(decided.what, scopeOf(cwd)) : null;
}

/** The reason to send the turn back with, or null after attaching what git moved. */
export async function stopWorkTree(
  payload: StopTurnPayload | null
): Promise<string | null> {
  if (!payload || !isOptedIn("workTree")) return null;
  const cwd = sessionDir();
  const lines = transcriptLines(payload);
  const sendBack =
    workTreeSendBack(payload, lines, cwd) ??
    (await decisionSendBack(payload, lines, cwd));
  if (sendBack) return sendBack;
  attachGitProgress(cwd);
  return null;
}

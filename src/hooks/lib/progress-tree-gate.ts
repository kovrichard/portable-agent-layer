/**
 * The end-of-turn check that keeps the progress tree true: a turn that produced
 * something (a commit, a branch, a PR, a published artifact) and recorded
 * nothing in the tree is sent back once to record it.
 */

import {
  callsThisTurn,
  commandsThisTurn,
  promptThisTurn,
  userOpenedThisTurn,
} from "./claim-check";
import { alreadySentBack, transcriptLines } from "./claim-log";
import { type DecisionLabel, decisionRequest, parseDecision } from "./decision-label";
import { hookFinalReply, hookSessionId } from "./hook-turn";
import { inference } from "./inference";
import { progressSession } from "./progress-session";
import { readTree, scopeOf } from "./progress-tree";
import { attachFactoryPrs } from "./progress-tree-factory";
import { attachGitProgress } from "./progress-tree-git";
import { renderPromptLine } from "./progress-tree-render";
import { sessionDir } from "./session-dir";
import { isOptedIn } from "./settings";
import type { StopTurnPayload } from "./stop";

const RECORDS_PROGRESS_RE = /\bpal\s+cli\s+progress\b/;
const RECORDS_DECISION_RE = /\bpal\s+cli\s+progress\s+decide\b/;

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

function whereWorkStands(scope: string, payload: StopTurnPayload): string {
  const tree = readTree(scope, undefined, progressSession(hookSessionId(payload)));
  return renderPromptLine(tree, false) ?? "Progress: nothing recorded yet";
}

function sendBackReason(
  produced: string[],
  scope: string,
  payload: StopTurnPayload
): string {
  const where = whereWorkStands(scope, payload);
  return [
    `This turn ${produced.join(", ")} but recorded nothing in the progress tree (${where}).`,
    'Record where the work stands with `pal cli progress stopped "…"`, plus `decide` or `attach` where they fit;',
    'if no node fits, open one first with `pal cli progress open "…"` (`--root` for unrelated work).',
  ].join(" ");
}

export function progressTreeSendBack(
  payload: StopTurnPayload,
  lines: string[],
  cwd: string
): string | null {
  if (!isOptedIn("progressTree") || !isOptedIn("progressTreeGate")) return null;
  if (alreadySentBack(payload)) return null;
  const commands = commandsThisTurn(lines);
  if (commands === null || commands.some((c) => RECORDS_PROGRESS_RE.test(c))) return null;
  const produced = producedThisTurn(commands, lines);
  return produced.length > 0 ? sendBackReason(produced, scopeOf(cwd), payload) : null;
}

type LabelDecision = (message: string, reply: string) => Promise<DecisionLabel | null>;

async function labelWithInference(message: string, reply: string) {
  const result = await inference(decisionRequest(message, reply));
  return result.success ? parseDecision(result.output) : null;
}

function decisionReason(what: string, scope: string, payload: StopTurnPayload): string {
  return [
    `This turn settled a decision (${what}) but recorded none in the progress tree (${whereWorkStands(scope, payload)}).`,
    'Record it with `pal cli progress decide "…"`; if no node fits, open one first with `pal cli progress open "…"`.',
  ].join(" ");
}

export async function decisionSendBack(
  payload: StopTurnPayload,
  lines: string[],
  cwd: string,
  label: LabelDecision = labelWithInference
): Promise<string | null> {
  if (!isOptedIn("progressTree") || !isOptedIn("progressTreeDecisionGate")) return null;
  if (alreadySentBack(payload)) return null;
  const commands = commandsThisTurn(lines);
  if (commands === null || commands.some((c) => RECORDS_DECISION_RE.test(c))) return null;
  if (!userOpenedThisTurn(lines)) return null;
  const message = promptThisTurn(lines);
  const reply = hookFinalReply(payload);
  if (!message || !reply) return null;
  const decided = await label(message, reply);
  return decided?.decision ? decisionReason(decided.what, scopeOf(cwd), payload) : null;
}

/** The reason to send the turn back with, or null after attaching what git moved. */
export async function stopProgressTree(
  payload: StopTurnPayload | null
): Promise<string | null> {
  if (!payload || !isOptedIn("progressTree")) return null;
  const cwd = sessionDir();
  attachFactoryPrs(scopeOf(cwd));
  const lines = transcriptLines(payload);
  const sendBack =
    progressTreeSendBack(payload, lines, cwd) ??
    (await decisionSendBack(payload, lines, cwd));
  if (sendBack) return sendBack;
  attachGitProgress(cwd, undefined, undefined, progressSession(hookSessionId(payload)));
  return null;
}

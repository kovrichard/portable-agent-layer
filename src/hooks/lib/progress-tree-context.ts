/**
 * Where the progress tree enters an agent's context: the block every new or
 * compacted session starts with, and the line every prompt carries.
 */

import { reactionTo } from "./interaction-reaction";
import { progressSession } from "./progress-session";
import { readTree, scopeOf } from "./progress-tree";
import { type GhRunner, ghPrView, settleAttachedPrs } from "./progress-tree-prs";
import { renderPromptLine, renderSessionContext } from "./progress-tree-render";
import { sessionDir } from "./session-dir";
import { isOptedIn } from "./settings";

function sessionTree(cwd: string, hookSession: string | undefined) {
  return readTree(scopeOf(cwd), undefined, progressSession(hookSession));
}

export function loadProgressTreeContext(
  cwd: string = sessionDir(),
  hookSession?: string,
  gh: GhRunner = ghPrView
): string {
  if (!isOptedIn("progressTree")) return "";
  settleAttachedPrs(scopeOf(cwd), cwd, { gh });
  return renderSessionContext(sessionTree(cwd, hookSession));
}

export function progressTreePromptLine(
  userText: string,
  cwd: string = sessionDir(),
  hookSession?: string
): string | null {
  if (!isOptedIn("progressTree")) return null;
  const newTopic = userText !== "" && reactionTo(userText, undefined) === "new-topic";
  const line = renderPromptLine(sessionTree(cwd, hookSession), newTopic);
  return line ? `<system-reminder>${line}</system-reminder>` : null;
}

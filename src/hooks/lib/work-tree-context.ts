/**
 * Where the work tree enters an agent's context: the block every new or
 * compacted session starts with, and the line every prompt carries.
 */

import { reactionTo } from "./interaction-reaction";
import { sessionDir } from "./session-dir";
import { isOptedIn } from "./settings";
import { workSession } from "./work-session";
import { readTree, scopeOf } from "./work-tree";
import { renderPromptLine, renderSessionContext } from "./work-tree-render";

function sessionTree(cwd: string, hookSession: string | undefined) {
  return readTree(scopeOf(cwd), undefined, workSession(hookSession));
}

export function loadWorkTreeContext(
  cwd: string = sessionDir(),
  hookSession?: string
): string {
  if (!isOptedIn("workTree")) return "";
  return renderSessionContext(sessionTree(cwd, hookSession));
}

export function workTreePromptLine(
  userText: string,
  cwd: string = sessionDir(),
  hookSession?: string
): string | null {
  if (!isOptedIn("workTree")) return null;
  const newTopic = userText !== "" && reactionTo(userText, undefined) === "new-topic";
  const line = renderPromptLine(sessionTree(cwd, hookSession), newTopic);
  return line ? `<system-reminder>${line}</system-reminder>` : null;
}

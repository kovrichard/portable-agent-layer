/**
 * Where the work tree enters an agent's context: the block every new or
 * compacted session starts with, and the line every prompt carries.
 */

import { reactionTo } from "./interaction-reaction";
import { sessionDir } from "./session-dir";
import { isOptedIn } from "./settings";
import { readTree, scopeOf } from "./work-tree";
import { renderPromptLine, renderSessionContext } from "./work-tree-render";

export function loadWorkTreeContext(cwd: string = sessionDir()): string {
  if (!isOptedIn("workTree")) return "";
  return renderSessionContext(readTree(scopeOf(cwd)));
}

export function workTreePromptLine(
  userText: string,
  cwd: string = sessionDir()
): string | null {
  if (!isOptedIn("workTree")) return null;
  const newTopic = userText !== "" && reactionTo(userText, undefined) === "new-topic";
  const line = renderPromptLine(readTree(scopeOf(cwd)), newTopic);
  return line ? `<system-reminder>${line}</system-reminder>` : null;
}

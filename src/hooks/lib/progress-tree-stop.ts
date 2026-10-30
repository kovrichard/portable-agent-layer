import { hookSessionId } from "./hook-turn";
import { progressSession } from "./progress-session";
import { scopeOf } from "./progress-tree";
import { attachFactoryPrs } from "./progress-tree-factory";
import { attachGitProgress } from "./progress-tree-git";
import { sessionDir } from "./session-dir";
import { isOptedIn } from "./settings";
import type { StopTurnPayload } from "./stop";

export function stopProgressTree(payload: StopTurnPayload | null): void {
  if (!payload || !isOptedIn("progressTree")) return;
  const cwd = sessionDir();
  attachFactoryPrs(scopeOf(cwd));
  attachGitProgress(cwd, undefined, undefined, progressSession(hookSessionId(payload)));
}

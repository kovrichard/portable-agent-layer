import { hookSessionId, type StopTurnPayload } from "../core/hook-payload";
import { sessionDir } from "../core/session-dir";
import { progressSession } from "./progress-session";
import { scopeOf } from "./progress-tree";
import { attachFactoryPrs } from "./progress-tree-factory";
import { attachGitProgress } from "./progress-tree-git";

export function stopProgressTree(payload: StopTurnPayload | null): void {
  if (!payload) return;
  const cwd = sessionDir();
  attachFactoryPrs(scopeOf(cwd));
  attachGitProgress(cwd, undefined, undefined, progressSession(hookSessionId(payload)));
}

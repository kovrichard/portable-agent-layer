/**
 * After a shell call that ran git, the checkout's state as it is now: the user
 * commits in parallel, so a status read earlier in the turn is already stale.
 * Informational only — any failure yields no output and never fails the call.
 */

import { normalizeToolUse } from "./agent";
import { appendEvent, logQuietly } from "./events";
import { chooseRepo, type RepoChoice, runsGit, runsGitCommit } from "./git-command-repo";
import { hookSessionId } from "./hook-turn";
import {
  type ChangedFile,
  count,
  type Git,
  gitOutput,
  parseStatus,
  repoStatusParts,
} from "./repo-state";
import { isEnabled } from "./settings";
import { COMMAND_KEYS, stringIn } from "./tool-events";

const MAX_FILES = 10;
const MAX_SUBJECT = 72;
const UNKNOWN_DURATION_MS = 120_000;

type Payload = Record<string, unknown>;

interface GitInfo {
  text: string;
  changed: number;
  committedFiles: number | null;
}

function capped(items: string[]): string {
  const more = items.length - MAX_FILES;
  const shown = items.slice(0, MAX_FILES).join(", ");
  return more > 0 ? `${shown}, +${more} more` : shown;
}

function describeChanged(files: ChangedFile[]): string {
  return capped(files.map((f) => `${f.path} (${f.state})`));
}

function stateLine(toplevel: string, porcelain: string) {
  const status = parseStatus(porcelain);
  const line = repoStatusParts(toplevel, status).join(" · ");
  const files = status.files.length > 0 ? ` — ${describeChanged(status.files)}` : "";
  return {
    text: `Git state after this command: ${line}${files}`,
    changed: status.files.length,
  };
}

function headCommitLine(git: Git, toplevel: string) {
  const shown = git(toplevel, "show", "--name-status", "--format=%h %s", "HEAD");
  if (!shown) return null;
  const [title = "", ...rest] = shown.split("\n");
  const files = rest.filter(Boolean).map((line) => line.split("\t").join(" "));
  const [hash, ...subject] = title.split(" ");
  const quoted = subject.join(" ").slice(0, MAX_SUBJECT);
  const contents =
    files.length > 0
      ? `${count(files.length, "file")}: ${capped(files)}`
      : "no file changes";
  return { text: `HEAD ${hash} "${quoted}" contains ${contents}`, files: files.length };
}

/** The repo-state text for one checkout, with HEAD's files after a commit. */
function gitInfo(git: Git, toplevel: string, afterCommit: boolean): GitInfo | null {
  const porcelain = git(toplevel, "status", "--porcelain=v2", "--branch");
  if (porcelain === null) return null;
  const state = stateLine(toplevel, porcelain);
  const head = afterCommit ? headCommitLine(git, toplevel) : null;
  return {
    text: head ? `${state.text}\n${head.text}` : state.text,
    changed: state.changed,
    committedFiles: head?.files ?? null,
  };
}

function callStartedAtMs(payload: Payload, now: number): number {
  const duration = payload.duration_ms;
  return now - (typeof duration === "number" ? duration : UNKNOWN_DURATION_MS);
}

function logInjection(
  payload: Payload,
  command: string,
  repo: RepoChoice,
  info: GitInfo
) {
  logQuietly("git_state_injected", () => {
    appendEvent(
      "git_state_injected",
      {
        trigger: runsGitCommit(command) ? "commit" : "git",
        source: repo.source,
        changed: info.changed,
        committedFiles: info.committedFiles,
        chars: info.text.length,
      },
      {
        session: hookSessionId(payload) ?? null,
        cwd: repo.toplevel,
        content: { command, repo: repo.toplevel, text: info.text },
      }
    );
  });
}

function bashCommand(payload: Payload): string | null {
  const call = normalizeToolUse(payload);
  if (call?.toolName !== "Bash") return null;
  return stringIn(call.toolInput, COMMAND_KEYS);
}

function injectedInfo(payload: Payload, git: Git, now: number): string | null {
  const command = bashCommand(payload);
  if (!command || !runsGit(command) || !isEnabled("repoState")) return null;
  const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
  const repo = chooseRepo(git, command, cwd, callStartedAtMs(payload, now));
  const info = repo ? gitInfo(git, repo.toplevel, runsGitCommit(command)) : null;
  if (!repo || !info) return null;
  logInjection(payload, command, repo, info);
  return info.text;
}

/** Claude Code's PostToolUse reply carrying the repo state, or null to stay silent. */
export function postGitInfoResponse(
  payload: Payload | null,
  git: Git = gitOutput,
  now: number = Date.now()
): string | null {
  try {
    const text = payload ? injectedInfo(payload, git, now) : null;
    if (!text) return null;
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text },
    });
  } catch {
    return null;
  }
}

/**
 * `pal cli report send --pr`: the report goes up as a pull request carrying the
 * fix already committed in a PAL checkout. Its commits and diff pass the same
 * leak check as the report before anything leaves the machine.
 */

import { spawnSync } from "node:child_process";
import { PAL_REPO_URL } from "../core/remote";
import { findLeaks, type Identifiers, type Leak, machineIdentifiers } from "./leaks";
import {
  type Gh,
  REPORT_LABEL,
  type Report,
  recordBlocked,
  recordSent,
  runGh,
  shownText,
  UPSTREAM_REPO,
  writeBodyFile,
} from "./report";

interface CommandResult {
  ok: boolean;
  out: string;
}

export type Git = (args: string[]) => CommandResult;

export const gitIn =
  (dir: string): Git =>
  (args) => {
    const res = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });

    return { ok: res.status === 0, out: `${res.stdout ?? ""}`.trim() };
  };

type LeakSource = "report" | "commits" | "diff";

export type PrOutcome =
  | { kind: "blocked"; source: LeakSource; leaks: Leak[] }
  | { kind: "refused"; reason: string }
  | { kind: "opened"; url: string };

const BASE = "canary";
const UPSTREAM_OWNER = UPSTREAM_REPO.split("/")[0];
const REPO_NAME = UPSTREAM_REPO.split("/")[1];

const refused = (reason: string): PrOutcome => ({ kind: "refused", reason });

/** The fix: commit messages and diff against upstream canary, or why there is none. */
function fixOf(git: Git): { commits: string; diff: string } | string {
  if (!git(["fetch", "--quiet", `${PAL_REPO_URL}.git`, BASE]).ok)
    return `This folder is not a git checkout that can fetch ${UPSTREAM_REPO}.`;

  if (!git(["merge-base", "FETCH_HEAD", "HEAD"]).ok)
    return `This folder shares no history with ${UPSTREAM_REPO}.`;
  const commits = git(["log", "--format=%B", "FETCH_HEAD..HEAD"]).out;
  if (!commits) return `No commits ahead of ${BASE}: commit the fix first.`;

  return { commits, diff: git(["diff", "FETCH_HEAD...HEAD"]).out };
}

type Blocked = Extract<PrOutcome, { kind: "blocked" }>;

function firstLeaks(parts: [LeakSource, string][], ids: Identifiers): Blocked | null {
  for (const [source, text] of parts) {
    const leaks = findLeaks(text, ids);
    if (leaks.length > 0) return { kind: "blocked", source, leaks };
  }

  return null;
}

/** Where the branch goes: upstream for its owner, the user's fork for anyone else. */
function headOwner(gh: Gh): string | null {
  const login = gh(["api", "user", "--jq", ".login"]);
  if (!login.ok || !login.out) return null;

  if (login.out === UPSTREAM_OWNER) return login.out;

  return gh(["repo", "fork", UPSTREAM_REPO, "--clone=false"]).ok ? login.out : null;
}

function pushAndOpen(report: Report, git: Git, gh: Gh): PrOutcome {
  const owner = headOwner(gh);
  if (!owner) return refused(`Could not find or create your fork of ${UPSTREAM_REPO}.`);
  const branch = `report/${report.id}`;
  const remote = `https://github.com/${owner}/${REPO_NAME}.git`;
  if (!git(["push", "--quiet", remote, `HEAD:refs/heads/${branch}`]).ok)
    return refused(`Could not push ${branch} to ${owner}/${REPO_NAME}.`);
  const created = gh([
    "pr",
    "create",
    "-R",
    UPSTREAM_REPO,
    "--base",
    BASE,
    "--head",
    `${owner}:${branch}`,
    "--title",
    report.title,
    "--body-file",
    writeBodyFile(report),
    "--label",
    REPORT_LABEL,
  ]);
  if (!created.ok) return refused(`gh could not open the pull request: ${created.out}`);

  return { kind: "opened", url: created.out.split("\n").at(-1) ?? "" };
}

export function openPullRequest(
  report: Report,
  options: { git: Git; gh?: Gh; ids?: Identifiers }
): PrOutcome {
  const gh = options.gh ?? runGh;
  const ids = options.ids ?? machineIdentifiers();

  if (!gh(["auth", "status"]).ok)
    return refused(
      "A pull request needs gh signed in. Without it, send the report as an issue."
    );
  const fix = fixOf(options.git);
  if (typeof fix === "string") return refused(fix);
  const blocked = firstLeaks(
    [
      ["report", shownText(report)],
      ["commits", fix.commits],
      ["diff", fix.diff],
    ],
    ids
  );

  if (blocked) {
    recordBlocked(report, blocked.leaks.length);

    return blocked;
  }

  const outcome = pushAndOpen(report, options.git, gh);
  if (outcome.kind === "opened") recordSent(report, "pr");

  return outcome;
}

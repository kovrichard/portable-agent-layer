/**
 * Shared security definitions and validation logic.
 * Used by SecurityValidator.ts (Claude Code) and the opencode plugin.
 */

import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { palHome, platform } from "./paths";

// PowerShell aliases rm, rmdir, del, erase, rd and ri all to Remove-Item, and
// cmd ships its own rd and del — so the verb alone never says which shell ran it.
const WIN_DELETE_VERB = "(?:remove-item|rmdir|erase|del|rd|rm|ri)";

// -r through -Recurse all bind in PowerShell; cmd's rd/del spell it /s.
const WIN_RECURSE_FLAG = String.raw`(?:-(?:r(?:e(?:c(?:u(?:r(?:se?)?)?)?)?)?f?|fr)|/s)\b`;

/**
 * A whole root, not a directory inside one. The trailing lookahead is the part
 * that matters: without it `C:\` prefix-matches `C:\Users\user\dist` and every
 * ordinary recursive delete on Windows gets blocked.
 */
const WIN_ROOT_TARGET = String.raw`["']?(?:[a-z]:[\\/]?\*?|\\\\|~|\$home|\$env:userprofile|\$env:systemdrive)["']?(?=["'\s;,)]|$)`;

const WIN_DOWNLOAD = "(?:iwr|irm|curl|wget|invoke-webrequest|invoke-restmethod)";
const WIN_EVAL = "(?:iex|invoke-expression)";

/**
 * Something is about to be run, rather than merely named. `format` and
 * `diskpart` are bare enough to collide with ordinary text — a PR title reading
 * `fix: format C: handling` or `rg 'diskpart' docs/` are not disk operations.
 * The optional wrapper keeps `powershell -c "format C:"` in scope.
 */
const SHELL_WRAPPER = String.raw`(?:(?:sudo|powershell(?:\.exe)?|pwsh|cmd(?:\.exe)?)\s+(?:[-/]\w+\s+)*)?`;
const COMMAND_POSITION = String.raw`(?:^|[|;&\n({])\s*${SHELL_WRAPPER}["']?`;

/**
 * Start-Process/runas/gsudo hand the target to a flag (-FilePath, -ArgumentList)
 * or a positional slot after other flags, in either order — COMMAND_POSITION's
 * fixed wrapper-then-verb shape can't follow that. Since nobody launches a
 * process via Start-Process to hold a PR title, an elevation wrapper anywhere in
 * the command is itself enough license to drop the position anchor entirely.
 */
/**
 * Both lookaheads stop at |, ; and & so they cannot reach across a command
 * boundary — otherwise `rm -r build; echo C:\` reads as a root delete.
 */
const WIN_ROOT_DELETE = new RegExp(
  String.raw`${COMMAND_POSITION}${WIN_DELETE_VERB}\b(?=[^|;&\n]*\s${WIN_RECURSE_FLAG})(?=[^|;&\n]*\s${WIN_ROOT_TARGET})`,
  "i"
);

const WIN_FORMAT_COMMAND = new RegExp(
  String.raw`${COMMAND_POSITION}format(?:\s+["']?[a-z]:|-volume\b)`,
  "i"
);
const WIN_DISKPART_COMMAND = new RegExp(String.raw`${COMMAND_POSITION}diskpart\b`, "i");

/**
 * Start-Process/runas/gsudo hand the target to a flag (-FilePath, -ArgumentList)
 * or a positional slot after other flags, in either order — COMMAND_POSITION's
 * fixed wrapper-then-verb shape can't follow that, and a single combined regex
 * can't either: a lookahead only sees forward from the verb, so it misses
 * `Start-Process -Verb RunAs -FilePath diskpart` where the wrapper comes first.
 * Two independent whole-string checks (wrapper present, threat present anywhere)
 * sidestep the ordering problem entirely. Nobody launches a process via
 * Start-Process to hold a PR title, so no position anchor is needed here.
 */
const WIN_ELEVATION_WRAPPER = /\b(?:start-process|runas|gsudo)\b/i;
const WIN_ELEVATED_THREATS: [RegExp, string][] = [
  [
    new RegExp(
      String.raw`\b${WIN_DELETE_VERB}\b(?=[^|;&\n]*\s${WIN_RECURSE_FLAG})(?=[^|;&\n]*\s${WIN_ROOT_TARGET})`,
      "i"
    ),
    "Recursive delete of a drive root or home",
  ],
  [/\bformat(?:\s+["']?[a-z]:|-volume\b)/i, "Disk format"],
  [/\bdiskpart\b/i, "Disk partitioning"],
];

/** Dangerous command patterns — always blocked */
const BLOCKED_COMMANDS: [RegExp, string][] = [
  [/rm\s+-rf\s+[/~]/, "Recursive delete of root or home"],
  [/mkfs\./, "Filesystem format"],
  [/dd\s+if=.*of=\/dev\//, "Raw disk write"],
  [/>\s*\/dev\/sd/, "Direct device write"],
  [/chmod\s+-R\s+777\s+\//, "Recursive world-writable root"],
  [/:\(\)\{\s*:\|:&\s*\};:/, "Fork bomb"],
  [/curl.*\|\s*(?:ba)?sh/, "Pipe to shell"],
  [/wget.*\|\s*(?:ba)?sh/, "Pipe to shell"],
  [WIN_ROOT_DELETE, "Recursive delete of a drive root or home"],
  [WIN_FORMAT_COMMAND, "Disk format"],
  [WIN_DISKPART_COMMAND, "Disk partitioning"],
  [
    new RegExp(String.raw`\b${WIN_DOWNLOAD}\b[^|\n]*\|\s*${WIN_EVAL}\b`, "i"),
    "Pipe to shell",
  ],
  [
    new RegExp(
      String.raw`\b${WIN_EVAL}\b[^|\n]*(?:downloadstring|downloadfile|new-object\s+(?:system\.)?net\.webclient|\b${WIN_DOWNLOAD}\b)`,
      "i"
    ),
    "Download and execute",
  ],
];

/** Hook-managed files — single source of truth */
const HOOK_MANAGED_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  "ratings.jsonl",
  "sessions.json",
  "captured-learnings.json",
  "counts.json",
  "session-names.json",
  "last-responses.json",
  "signal-cache.json",
  "pending-failure.json",
  "token-usage.jsonl",
  "graduated.json",
  "update-available.json",
  "opinions.json",
  "pal-settings.json",
  "skill-index.json",
  "algorithm-reflections.jsonl",
  ".retrieval-index.json",
];

/** Hook-managed directories — AI must not write to or delete from these */
const HOOK_MANAGED_DIRS = [
  "memory/signals",
  "memory/learning/failures",
  "memory/learning/session",
  "memory/learning/synthesis",
  "memory/relationship",
  "memory/wisdom/state",
  "memory/projects",
  "memory/state/progress",
  "debug",
];

/** PAL-deployed dirs — engine-managed, overwritten on every `pal install` */
const PAL_INSTALLED_DIRS = ["docs", "skills", "tools"];

/** Paths that should never be written to */
const PROTECTED_PATHS: RegExp[] = [
  /^\/etc\//,
  /^\/boot\//,
  /^\/System\//,
  /\.ssh\/(?!config)/,
  /\.gnupg\//,
  // Claude Code auto-memory — PAL owns memory; writes here indicate wrong system is being used
  /\.claude\/projects\/[^/]+\/memory\//,
];

function comparable(path: string): string {
  const forward = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? forward.toLowerCase() : forward;
}

function absoluteComparable(path: string): string {
  return comparable(resolve(path.replaceAll("\\", "/")));
}

/** The part of `path` below `root`, or null when `path` is outside it. */
function pathBelow(root: string, path: string): string | null {
  const base = absoluteComparable(root);
  const target = absoluteComparable(path);
  return target.startsWith(`${base}/`) ? target.slice(base.length + 1) : null;
}

/** The real directories PAL writes user state into, not any folder that shares their name. */
function managedRoots(): string[] {
  return [
    palHome(),
    platform.claudeDir(),
    platform.agentsDir(),
    platform.cursorDir(),
    platform.opencodeDir(),
  ];
}

function pathInsideManagedRoot(path: string): string | null {
  for (const root of managedRoots()) {
    const below = pathBelow(root, path);
    if (below !== null) return below;
  }
  return null;
}

function managedFileAt(below: string): string | undefined {
  return HOOK_MANAGED_FILES.find((name) => {
    const file = comparable(name);
    return below === file || below.endsWith(`/${file}`);
  });
}

function managedDirAt(below: string): string | undefined {
  return HOOK_MANAGED_DIRS.find((dir) => `/${below}/`.includes(`/${comparable(dir)}/`));
}

function managedPathReason(path: string): string | null {
  const below = pathInsideManagedRoot(path);
  if (below === null) return null;
  const file = managedFileAt(below);
  if (file) return `${file} is managed automatically by hooks — do not edit directly`;
  const dir = managedDirAt(below);
  if (dir) return `${dir}/ is managed automatically by hooks — do not edit directly`;
  return null;
}

const HOME_PREFIX =
  /^(?:~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|%USERPROFILE%)(?=[/\\]|$)/i;
const COMMAND_TOKEN = /[^\s'"`<>|;&()=]+/g;

function pathsNamedIn(segment: string): string[] {
  return Array.from(segment.matchAll(COMMAND_TOKEN), (m) => m[0])
    .filter((token) => HOME_PREFIX.test(token) || /[/\\]/.test(token))
    .map((token) => token.replace(HOME_PREFIX, () => homedir()));
}

function managedReasonInSegment(segment: string): string | null {
  for (const path of pathsNamedIn(segment)) {
    const reason = managedPathReason(path);
    if (reason) return reason;
  }
  return null;
}

/** Read-only commands allowed to reference protected files */
const READ_ONLY_COMMANDS =
  /^\s*(?:cat|head|tail|less|more|grep|rg|wc|diff|stat|file|ls|dir|find|git\s+(?:log|diff|blame|show|status)|bat)\b/;

/** Check a bash command against blocked patterns. Returns reason string or null. */
export function checkBashCommand(cmd: string): string | null {
  for (const [pattern, reason] of BLOCKED_COMMANDS) {
    if (pattern.test(cmd)) return reason;
  }
  if (WIN_ELEVATION_WRAPPER.test(cmd)) {
    for (const [pattern, reason] of WIN_ELEVATED_THREATS) {
      if (pattern.test(cmd)) return reason;
    }
  }
  const segments = cmd.split(/[|;&]/).map((s) => s.trim());
  for (const segment of segments) {
    const reason = managedReasonInSegment(segment);
    if (reason && !READ_ONLY_COMMANDS.test(segment)) return reason;
  }
  return null;
}

/**
 * Shipped skills are symlinks into the PAL repo (engine-managed); personal
 * skills are real dirs authored in place. A not-yet-created skill dir is also
 * personal (scaffolding). So: symlink → shipped/protected, otherwise → personal.
 */
function isShippedSkill(name: string): boolean {
  try {
    return lstatSync(resolve(palHome(), "skills", name)).isSymbolicLink();
  } catch {
    return false;
  }
}

function palInstalledReason(path: string): string | null {
  const [dir, entry] = pathBelow(palHome(), path)?.split("/") ?? [];
  if (!dir || !entry || !PAL_INSTALLED_DIRS.includes(dir)) return null;
  if (dir === "skills" && !isShippedSkill(entry)) return null;
  return `~/.pal/${dir}/ is managed by 'pal install' — edit the source in the PAL repo instead`;
}

/** Check a file path against protected patterns. Returns a reason string or null. */
export function checkFilePath(filePath: string): string | null {
  const reason = managedPathReason(filePath) ?? palInstalledReason(filePath);
  if (reason) return reason;
  if (PROTECTED_PATHS.some((pattern) => pattern.test(filePath))) {
    return `Protected path: ${filePath}`;
  }
  return null;
}

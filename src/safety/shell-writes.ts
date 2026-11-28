/**
 * Whether a shell command writes to a protected path. Reads are never refused:
 * a command that only names a protected path (cd, cat, jq, sed -n, awk) passes,
 * and a command is refused only when it writes to one or cannot say where it writes.
 */

import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export type ProtectedReason = (path: string) => string | null;

const HOME_PREFIX =
  /^(?:~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|%USERPROFILE%)(?=[/\\]|$)/i;
const COMMAND_TOKEN = /[^\s'"`<>|;&()=]+/g;
const QUOTED = /(["'])([\s\S]*?)\1/g;
const CODE_RUNNER =
  /(?:^|[\s/\\])(?:(?:ba|z|da|k|fi)?sh|python[\d.]*|node|bun|deno|perl|ruby|php|pwsh|powershell|cmd)(?:\.exe)?(?=\s|$)/i;
const INLINE_CODE_FLAG =
  /\s(?:-[a-z]*[ceEpr]|--eval|-command|-encodedcommand|\/c)(?=\s|$)/i;

const WRITERS = new Set([
  "rm",
  "rmdir",
  "mv",
  "cp",
  "tee",
  "touch",
  "mkdir",
  "ln",
  "truncate",
  "chmod",
  "chown",
  "install",
  "rsync",
  "dd",
  "shred",
  "unzip",
  "tar",
  "patch",
]);
const DESTINATION_ONLY = new Set(["cp", "rsync", "install", "ln"]);
const EDITS_IN_PLACE = new Set(["sed", "perl", "ruby"]);
const IN_PLACE_FLAG = /^(?:-[a-zA-Z]*i|--in-place)/;
const WRAPPERS = new Set(["sudo", "env", "nice", "time", "command", "nohup"]);
const FED_FROM_STDIN = new Set(["xargs", "sh", "bash", "zsh", "dash", "source", "."]);
const REDIRECT = /^(?:\d*|&)>>?(.*)$/;
const STREAM_DUPLICATE = /^\d*>&\d+$/;

const expandHome = (token: string) => token.replace(HOME_PREFIX, () => homedir());

const CODE_FROM_STDIN = /\s(?:-|<<-?\s*['"]?\w+['"]?)(?=\s|$)/;
const WRITE_API =
  /\bopen\s*\([^)]*,\s*["'][^"']*[wax+]|write_text|write_bytes|writeFile|appendFile|Bun\.write|\.write\s*\(|unlink|rmSync|rmtree|os\.remove|shutil\.(?:move|copy)|renameSync|os\.rename|\.rename\s*\(|truncate|mkdirSync|os\.makedirs/;

function runsInlineCode(segment: string): boolean {
  const unquoted = segment.replace(QUOTED, " ");
  if (/(?:^|\s)eval(?=\s|$)/.test(unquoted)) return true;

  return (
    CODE_RUNNER.test(unquoted) &&
    (INLINE_CODE_FLAG.test(unquoted) || CODE_FROM_STDIN.test(unquoted))
  );
}

const SHELL_RUNNER = /(?:^|\s)(?:eval|(?:ba|z|da|k|fi)?sh)(?=\s|$)/;
const SHELL_WRITE =
  />|\b(?:rm|rmdir|mv|cp|tee|touch|mkdir|ln|truncate|chmod|chown|dd|shred)\b|\bsed\s+-i|\bperl\s+-[a-z]*i/;

/** Inline code cannot be parsed for its targets, so code that calls no write API is taken as a read. */
const inlineCodeWrites = (segment: string) =>
  WRITE_API.test(segment) || (SHELL_RUNNER.test(segment) && SHELL_WRITE.test(segment));

function withoutQuotedProse(segment: string): string {
  return segment.replace(QUOTED, (whole, _quote, body: string) =>
    /\s/.test(body) ? " " : whole
  );
}

/** The paths a segment names, with the home spelled out; inline code is searched whole. */
function pathsNamedIn(segment: string): string[] {
  const text = runsInlineCode(segment) ? segment : withoutQuotedProse(segment);

  return Array.from(text.matchAll(COMMAND_TOKEN), (m) => m[0])
    .filter((token) => HOME_PREFIX.test(token) || /[/\\]/.test(token))
    .map(expandHome);
}

function words(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) =>
    w.replace(/^(["'])([\s\S]*)\1$/, "$2")
  );
}

/** A bare `>` or `>>` takes the next word as its target; `2>/dev/null` and `2>&1` carry their own. */
const takesNextWord = (word: string | undefined) =>
  word !== undefined && REDIRECT.exec(word)?.[1] === "" && !STREAM_DUPLICATE.test(word);

function redirectTargets(all: string[]): string[] {
  return all.flatMap((word, i) => {
    const redirect = REDIRECT.exec(word);
    if (!redirect || STREAM_DUPLICATE.test(word)) return [];

    const target = takesNextWord(word) ? all[i + 1] : redirect[1];

    return target ? [target] : [];
  });
}

/** The command and its arguments, past assignments, wrappers and redirects. */
function commandOf(all: string[]): string[] {
  const plain = all.filter((w, i) => !REDIRECT.test(w) && !takesNextWord(all[i - 1]));
  let start = 0;

  while (
    start < plain.length &&
    (/^[A-Za-z_]\w*=/.test(plain[start]) || WRAPPERS.has(plain[start]))
  )
    start++;

  return plain.slice(start);
}

const operands = (args: string[]) => args.filter((a) => !a.startsWith("-"));

type Write = { targets: string[] } | "target-unknown" | null;

function commandWrite([command, ...args]: string[]): string[] {
  if (!command) return [];

  if (WRITERS.has(command))
    return DESTINATION_ONLY.has(command) ? operands(args).slice(-1) : operands(args);

  if (EDITS_IN_PLACE.has(command) && args.some((a) => IN_PLACE_FLAG.test(a)))
    return operands(args);

  if (command === "find" && args.some((a) => a === "-delete" || a.startsWith("-exec")))
    return args.slice(
      0,
      args.findIndex((a) => a.startsWith("-"))
    );

  return [];
}

function writeOf(segment: string): Write {
  const all = words(segment);
  const command = commandOf(all);

  if (runsInlineCode(segment)) return inlineCodeWrites(segment) ? "target-unknown" : null;

  if (FED_FROM_STDIN.has(command[0] ?? "")) return "target-unknown";
  const targets = [...redirectTargets(all), ...commandWrite(command)];

  return targets.length > 0 ? { targets } : null;
}

function firstReason(paths: string[], reasonFor: ProtectedReason): string | null {
  for (const path of paths) {
    const reason = reasonFor(path);
    if (reason) return reason;
  }

  return null;
}

/** After `cd <protected folder>`, a relative target is inside it. */
function cdReason(
  command: string[],
  reasonFor: ProtectedReason
): string | null | undefined {
  if (command[0] !== "cd") return undefined;
  const target = command[1];

  return target ? reasonFor(resolve(expandHome(target))) : null;
}

function targetReason(
  target: string,
  reasonFor: ProtectedReason,
  protectedCwd: string | null
): string | null {
  const path = expandHome(target);
  if (isAbsolute(path)) return reasonFor(resolve(path));

  return protectedCwd;
}

interface SegmentContext {
  reasonFor: ProtectedReason;
  /** The protected path each segment names, by index. */
  named: (string | null)[];
  protectedCwd: string | null;
}

/** Code is judged by the paths it names itself; xargs and sh by what the segments before them feed in. */
function unknownTargetReason(
  segment: string,
  i: number,
  ctx: SegmentContext
): string | null {
  const fedFrom = runsInlineCode(segment)
    ? ctx.named[i]
    : ctx.named.slice(0, i).find(Boolean);

  return fedFrom ?? ctx.protectedCwd;
}

function segmentWriteReason(
  segment: string,
  i: number,
  ctx: SegmentContext
): string | null {
  const write = writeOf(segment);
  if (write === "target-unknown") return unknownTargetReason(segment, i, ctx);

  if (!write) return null;

  return firstReason(write.targets, (t) =>
    targetReason(t, ctx.reasonFor, ctx.protectedCwd)
  );
}

/** Why the command, split into its segments, writes to a protected path; null when it does not. */
export function protectedWriteReason(
  segments: string[],
  reasonFor: ProtectedReason
): string | null {
  const ctx: SegmentContext = {
    reasonFor,
    named: segments.map((s) => firstReason(pathsNamedIn(s), reasonFor)),
    protectedCwd: null,
  };

  for (const [i, segment] of segments.entries()) {
    const cd = cdReason(commandOf(words(segment)), reasonFor);

    if (cd !== undefined) {
      ctx.protectedCwd = cd;
      continue;
    }

    const reason = segmentWriteReason(segment, i, ctx);
    if (reason) return reason;
  }

  return null;
}

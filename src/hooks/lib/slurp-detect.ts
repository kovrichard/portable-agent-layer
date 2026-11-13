import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { toPath } from "./paths";

export interface SlurpHit {
  path: string;
  idiom: string;
  bytes: number;
}

export interface FileProbe {
  sizeOf(path: string): number | null;
  readScript(path: string): string | null;
}

const MAX_SCRIPT_BYTES = 256 * 1024;
const SCRIPT_EXTENSIONS = new Set([".py", ".js", ".mjs", ".cjs", ".ts", ".mts", ".sh"]);
const SHELL_OPERATORS = new Set(["|", "||", "&&", ";", "&", "\n"]);

const CODE_IDIOMS: [string, RegExp][] = [
  ["readFileSync", /readFileSync\(\s*(["'`])([^"'`]+)\1/g],
  ["readFile", /\breadFile\(\s*(["'`])([^"'`]+)\1/g],
  [
    "Bun.file",
    /Bun\.file\(\s*(["'`])([^"'`]+)\1\s*\)\s*\.(?:text|json|arrayBuffer|bytes)\(/g,
  ],
  ["open().read", /\bopen\(\s*(["'])([^"']+)\1[^)]*\)\s*\.read(?:lines)?\(\s*\)/g],
  ["json.load", /json\.load\(\s*open\(\s*(["'])([^"']+)\1/g],
  ["Path.read", /Path\(\s*(["'])([^"']+)\1\s*\)\s*\.read_(?:text|bytes)\(/g],
  [
    "pandas",
    /pd\.read_(?:csv|json|parquet|excel|table)\(\s*(["'])([^"']+)\1(?![^)]*chunksize)/g,
  ],
  ["$(cat)", /\$\(\s*cat\s+(["']?)([^\s"')|;&]+)\1\s*\)/g],
  ["mapfile", /\b(?:mapfile|readarray)\b[^<\n]*<\s*(["']?)([^\s"'|;&]+)\1/g],
];

const PYTHON_WITH_OPEN = /\bwith\s+open\(\s*(["'])([^"']+)\1[^)]*\)\s+as\s+(\w+)/g;

export const diskProbe: FileProbe = {
  sizeOf(path) {
    try {
      const stat = statSync(path);

      return stat.isFile() ? stat.size : null;
    } catch {
      return null;
    }
  },
  readScript(path) {
    const size = this.sizeOf(path);
    if (size === null || size > MAX_SCRIPT_BYTES) return null;

    try {
      return readFileSync(path, "utf-8");
    } catch {
      return null;
    }
  },
};

function expandPath(path: string, cwd: string): string | null {
  try {
    return toPath(path, cwd);
  } catch {
    return null;
  }
}

function pythonWithOpenSlurps(code: string): [string, string][] {
  return Array.from(code.matchAll(PYTHON_WITH_OPEN))
    .filter(([, , , name]) =>
      new RegExp(
        String.raw`\b${name}\.read(?:lines)?\(\s*\)|json\.load\(\s*${name}\s*\)`
      ).test(code)
    )
    .map(([, , path]) => ["with open().read", path as string]);
}

function codeSlurps(code: string): [idiom: string, path: string][] {
  const literal = CODE_IDIOMS.flatMap(([idiom, pattern]) =>
    Array.from(code.matchAll(pattern), (m) => [idiom, m[2] as string] as [string, string])
  );

  return [...literal, ...pythonWithOpenSlurps(code)];
}

const SHELL_TOKEN =
  /(\d*>&\d*)|(\|\||&&|[|;&\n<>])|((?:'[^']*'|"(?:\\.|[^"\\])*"|\\.|[^\s|;&<>'"\\])+)/g;
const SHELL_QUOTING = /'([^']*)'|"((?:\\.|[^"\\])*)"|\\(.)/g;

function unquoted(word: string): string {
  return word.replace(SHELL_QUOTING, (_, single, double, escaped) =>
    single !== undefined ? single : (double ?? escaped).replace(/\\(.)/g, "$1")
  );
}

export function shellTokens(command: string): string[] {
  return Array.from(command.matchAll(SHELL_TOKEN)).flatMap(([, , operator, word]) => {
    if (operator) return [operator];

    return word ? [unquoted(word)] : [];
  });
}

function pipelineSegments(tokens: string[]): string[][] {
  const segments: string[][] = [[]];

  for (const token of tokens) {
    if (SHELL_OPERATORS.has(token)) segments.push([]);
    else segments.at(-1)?.push(token);
  }

  return segments.filter((s) => s.length > 0);
}

function withoutEnvAssignments(segment: string[]): string[] {
  const start = segment.findIndex((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));

  return start < 0 ? [] : segment.slice(start);
}

function programName(segment: string[]): string {
  return (segment[0] ?? "").split("/").pop() ?? "";
}

function redirectedInput(segment: string[]): string | null {
  const at = segment.indexOf("<");

  return at >= 0 ? (segment[at + 1] ?? null) : null;
}

interface JqCall {
  files: string[];
  sideFiles: string[];
  slurp: boolean;
  streams: boolean;
  filterSeen: boolean;
}

type JqOption = (call: JqCall, args: string[], at: number) => number;

const skipValues =
  (count: number): JqOption =>
  (_, __, at) =>
    at + count;
const streams: JqOption = (call, _, at) => {
  call.streams = true;

  return at;
};
const slurps: JqOption = (call, _, at) => {
  call.slurp = true;

  return at;
};
const filterFromFile: JqOption = (call, _, at) => {
  call.filterSeen = true;

  return at + 1;
};
const sideFile: JqOption = (call, args, at) => {
  call.sideFiles.push(args[at + 2] ?? "");

  return at + 2;
};
const endOfFiles: JqOption = (_, args) => args.length;

const JQ_OPTIONS: Record<string, JqOption> = {
  "<": skipValues(1),
  ">": skipValues(1),
  "--stream": streams,
  "--seq": streams,
  "-s": slurps,
  "--slurp": slurps,
  "-f": filterFromFile,
  "--from-file": filterFromFile,
  "--indent": skipValues(1),
  "-L": skipValues(1),
  "--arg": skipValues(2),
  "--argjson": skipValues(2),
  "--slurpfile": sideFile,
  "--rawfile": sideFile,
  "--args": endOfFiles,
  "--jsonargs": endOfFiles,
};

function takeJqWord(call: JqCall, arg: string): void {
  if (/^-[a-zA-Z]+$/.test(arg)) call.slurp ||= arg.includes("s");
  else if (arg.startsWith("-")) return;
  else if (!call.filterSeen) call.filterSeen = true;
  else call.files.push(arg);
}

function parseJq(args: string[]): JqCall {
  const call: JqCall = {
    files: [],
    sideFiles: [],
    slurp: false,
    streams: false,
    filterSeen: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const option = JQ_OPTIONS[arg];
    if (option) i = option(call, args, i);
    else takeJqWord(call, arg);
  }

  return call;
}

function catFiles(segment: string[] | undefined): string[] {
  if (!segment || programName(segment) !== "cat") return [];

  return segment.slice(1).filter((t) => !t.startsWith("-"));
}

function stdinFiles(segment: string[], previous: string[] | undefined): string[] {
  const redirected = redirectedInput(segment);

  return redirected ? [redirected] : catFiles(previous);
}

function jqSlurps(segment: string[], previous: string[] | undefined): [string, string][] {
  const call = parseJq(segment.slice(1));
  const sides = call.sideFiles.map((f) => ["jq --slurpfile", f] as [string, string]);

  if (call.streams) return sides;
  const idiom = call.slurp ? "jq -s" : "jq";
  const inputs = call.files.length > 0 ? call.files : stdinFiles(segment, previous);

  return [...sides, ...inputs.map((f) => [idiom, f] as [string, string])];
}

function scriptArgument(segment: string[]): string | null {
  const script = segment.slice(1).find((t) => !t.startsWith("-") && t !== "run");

  return script && SCRIPT_EXTENSIONS.has(extname(script)) ? script : null;
}

function segmentSlurps(
  segment: string[],
  previous: string[] | undefined,
  cwd: string,
  probe: FileProbe
): [string, string][] {
  if (programName(segment) === "jq") return jqSlurps(segment, previous);
  const script = scriptArgument(segment);
  const scriptPath = script ? expandPath(script, cwd) : null;
  const source = scriptPath ? probe.readScript(scriptPath) : null;

  return source ? codeSlurps(source) : [];
}

export function commandSlurps(
  command: string,
  cwd: string,
  probe: FileProbe = diskProbe
): SlurpHit[] {
  const segments = pipelineSegments(shellTokens(command)).map(withoutEnvAssignments);
  const found = [
    ...codeSlurps(command),
    ...segments.flatMap((segment, i) =>
      segmentSlurps(segment, segments[i - 1], cwd, probe)
    ),
  ];
  const seen = new Set<string>();

  return found.flatMap(([idiom, path]) => {
    const full = expandPath(path, cwd);
    if (full === null) return [];
    const bytes = probe.sizeOf(full);
    const key = `${idiom}\0${full}`;
    if (bytes === null || seen.has(key)) return [];
    seen.add(key);

    return [{ path: full, idiom, bytes }];
  });
}

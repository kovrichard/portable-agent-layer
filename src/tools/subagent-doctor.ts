/**
 * subagent-doctor — static evaluator for a personal subagent definition
 * (~/.pal/agents/<name>.md) with merged multi-platform frontmatter. Checks only
 * what is mechanically verifiable: name/description constraints, per-platform
 * blocks (claude/opencode/cursor/copilot), model/tools/permission shape, body
 * length, and absolute-path portability.
 *
 * Library:  import { lintSubagent, formatSubagentReport } from ".../subagent-doctor"
 * Script:   bun src/tools/subagent-doctor.ts <file-or-name>
 *           (resolves a path, or a name under ~/.pal/agents/)
 * CLI:      pal cli subagent doctor <name>   (see src/cli/subagent.ts)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { assets, palHome } from "../hooks/lib/paths";

type Level = "pass" | "warn" | "error";

interface DoctorFinding {
  level: Level;
  check: string;
  message: string;
}

export interface SubagentReport {
  file: string;
  name: string | null;
  findings: DoctorFinding[];
  errors: number;
  warnings: number;
}

const AGENT_PLATFORMS = ["claude", "opencode", "cursor", "copilot"] as const;
type AgentPlatform = (typeof AGENT_PLATFORMS)[number];

interface ParsedSubagent {
  hasFrontmatter: boolean;
  name: string | null;
  description: string | null;
  descriptionQuoted: boolean;
  global: string[];
  platforms: Partial<Record<AgentPlatform, string[]>>;
  body: string;
}

const RESERVED_WORDS = ["anthropic", "claude"];
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_BODY_LINES = 500;

/** Model values PAL recognises across agents; anything else warns (naming drifts). */
const KNOWN_MODELS = ["inherit", "fable", "sonnet", "opus", "haiku"];
const PERMISSION_VALUES = ["allow", "ask", "deny"];
const OPENCODE_MODES = ["subagent", "primary", "all"];

/** Machine/user-specific absolute paths that will not survive an export. */
const ABSOLUTE_PATH_RE =
  /(?:\/(?:Users|home)\/[A-Za-z0-9._-]+|\/root\/[A-Za-z0-9._-]|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+)/;

/** Names of the subagents PAL ships — a personal subagent may not reuse one. */
function shippedAgentNames(): Set<string> {
  const dir = assets.agents();
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
  );
}

/** Split a merged subagent .md into global fields, per-platform blocks, and body. */
function parseSubagent(content: string): ParsedSubagent {
  const parts = content.split(/^---\s*$/m);
  if (parts.length < 3) {
    return {
      hasFrontmatter: false,
      name: null,
      description: null,
      descriptionQuoted: false,
      global: [],
      platforms: {},
      body: content,
    };
  }
  const frontmatter = parts[1];
  const body = parts.slice(2).join("---");

  const global: string[] = [];
  const platforms: Partial<Record<AgentPlatform, string[]>> = {};
  let current: AgentPlatform | null = null;

  for (const line of frontmatter.split("\n")) {
    if (!line.trim()) continue;
    const pm = /^(claude|opencode|cursor|copilot):\s*$/.exec(line);
    if (pm) {
      current = pm[1] as AgentPlatform;
      platforms[current] ??= [];
      continue;
    }
    if (current) {
      if (/^ {2}/.test(line)) {
        platforms[current]?.push(line.slice(2));
        continue;
      }
      current = null;
    }
    global.push(line);
  }

  const globalText = global.join("\n");
  const name = /^name:\s*"?(.+?)"?\s*$/m.exec(globalText)?.[1] ?? null;
  const rawDesc = /^description:[ \t]*(.*?)\s*$/m.exec(globalText)?.[1] ?? null;
  const descriptionQuoted =
    rawDesc !== null &&
    rawDesc.length >= 2 &&
    rawDesc.startsWith('"') &&
    rawDesc.endsWith('"');
  const description = descriptionQuoted ? rawDesc.slice(1, -1) : rawDesc;

  return {
    hasFrontmatter: true,
    name,
    description,
    descriptionQuoted,
    global,
    platforms,
    body,
  };
}

/** Value of a single-line `key: value` field within an un-indented block. */
function fieldValue(lines: string[], key: string): string | null {
  const re = new RegExp(String.raw`^${key}:[ \t]*(.*?)\s*$`);
  for (const line of lines) {
    const m = re.exec(line);
    if (m) return m[1].replace(/^"(.*)"$/, "$1");
  }
  return null;
}

/** True when a block declares `key:` (with or without an inline value). */
function hasField(lines: string[], key: string): boolean {
  return lines.some((l) => new RegExp(`^${key}:`).test(l));
}

function checkClaudeBlock(lines: string[], add: AddFinding): void {
  const model = fieldValue(lines, "model");
  if (model) validateModel(model, "claude", add);
  const tools = fieldValue(lines, "tools");
  if (tools !== null && tools.trim() === "") {
    add("warn", "claude.tools", "`tools` is empty — omit it to inherit all tools");
  }
}

function checkOpencodeBlock(lines: string[], add: AddFinding): void {
  const mode = fieldValue(lines, "mode");
  if (!mode) {
    add(
      "warn",
      "opencode.mode",
      "no `mode` — set `mode: subagent` so opencode treats it as a delegate"
    );
  } else if (!OPENCODE_MODES.includes(mode)) {
    add(
      "warn",
      "opencode.mode",
      `mode "${mode}" — expected one of ${OPENCODE_MODES.join(", ")}`
    );
  } else if (mode !== "subagent") {
    add("warn", "opencode.mode", `mode is "${mode}", not "subagent" — intended?`);
  }
  const model = fieldValue(lines, "model");
  if (model) validateModel(model, "opencode", add);
  for (const line of lines) {
    const perm = /^\s*(read|write|edit|bash|webfetch|skill):\s*"?([a-z-]+)"?\s*$/.exec(
      line
    );
    if (perm && !PERMISSION_VALUES.includes(perm[2])) {
      add(
        "warn",
        "opencode.permission",
        `${perm[1]}: "${perm[2]}" — expected ${PERMISSION_VALUES.join("/")}`
      );
    }
  }
}

function checkCursorBlock(lines: string[], add: AddFinding): void {
  const model = fieldValue(lines, "model");
  if (model) validateModel(model, "cursor", add);
  for (const key of ["readonly", "is_background"]) {
    const v = fieldValue(lines, key);
    if (v !== null && v !== "true" && v !== "false") {
      add("warn", `cursor.${key}`, `${key}: "${v}" — must be true or false`);
    }
  }
}

function checkCopilotBlock(lines: string[], add: AddFinding): void {
  const model = fieldValue(lines, "model");
  if (model) validateModel(model, "copilot", add);
}

function validateModel(model: string, platform: string, add: AddFinding): void {
  const known = KNOWN_MODELS.includes(model) || /^(claude-|gpt-|o\d|gemini-)/.test(model);
  if (!known) {
    add(
      "warn",
      `${platform}.model`,
      `model "${model}" is unrecognised — confirm it is a valid ${platform} model id/alias`
    );
  }
}

type AddFinding = (level: Level, check: string, message: string) => void;

/**
 * Evaluate the subagent file at `file` (a merged multi-platform .md) and return
 * a structured report. Loader-fatal problems surface as errors; best-practice
 * nudges surface as warnings.
 */
export function lintSubagent(file: string): SubagentReport {
  const findings: DoctorFinding[] = [];
  const add: AddFinding = (level, check, message) =>
    findings.push({ level, check, message });

  if (!existsSync(file)) {
    add("error", "structure", `No subagent file at ${file}`);
    return { file, name: null, findings, errors: 1, warnings: 0 };
  }

  const parsed = parseSubagent(readFileSync(file, "utf-8"));
  if (!parsed.hasFrontmatter) {
    add("error", "structure", "No frontmatter (--- … ---) block found");
    return { file, name: null, findings, errors: 1, warnings: 0 };
  }

  const { name, description, descriptionQuoted, platforms, body } = parsed;

  // ── name ──
  const stem = basename(file).replace(/\.md$/, "");
  if (!name) {
    add("error", "name", "Missing `name` in frontmatter");
  } else {
    name === stem
      ? add("pass", "name.file", `matches file name "${stem}"`)
      : add(
          "error",
          "name.file",
          `name "${name}" must equal the file name "${stem}" verbatim — otherwise the subagent is silently ignored`
        );
    name.length <= MAX_NAME
      ? add("pass", "name.length", `${name.length}/${MAX_NAME} chars`)
      : add("error", "name.length", `${name.length} chars exceeds ${MAX_NAME}`);
    /^[a-z0-9-]+$/.test(name)
      ? add("pass", "name.charset", "lowercase letters, numbers, hyphens only")
      : add(
          "error",
          "name.charset",
          `"${name}" must be lowercase a-z, 0-9, hyphens only`
        );
    const reserved = RESERVED_WORDS.find((w) => name.toLowerCase().includes(w));
    reserved
      ? add("error", "name.reserved", `contains reserved word "${reserved}"`)
      : add("pass", "name.reserved", "no reserved words");
    shippedAgentNames().has(name)
      ? add(
          "error",
          "name.collision",
          `"${name}" is a shipped PAL subagent — a reinstall would overwrite it; choose another name`
        )
      : add("pass", "name.collision", "does not collide with a shipped subagent");
  }

  // ── description ──
  if (!description) {
    add("error", "description", "Missing `description` in frontmatter");
  } else {
    description.length <= MAX_DESCRIPTION
      ? add(
          "pass",
          "description.length",
          `${description.length}/${MAX_DESCRIPTION} chars`
        )
      : add(
          "error",
          "description.length",
          `${description.length} chars exceeds ${MAX_DESCRIPTION}`
        );
    descriptionQuoted
      ? add("pass", "description.quoted", "value is wrapped in double quotes")
      : add(
          "warn",
          "description.quoted",
          'value is not wrapped in double quotes — unquoted YAML mis-parses on colons and commas; wrap it in "..."'
        );
    /<[^>]+>/.test(description)
      ? add(
          "warn",
          "description.xml",
          "contains angle-bracket content — rephrase placeholders in prose"
        )
      : add("pass", "description.xml", "no XML tags");
    /\bwhen\b/i.test(description)
      ? add("pass", "description.trigger", "states when to delegate to the subagent")
      : add(
          "warn",
          "description.trigger",
          "no 'when to use' trigger — add 'Use when …' so the model knows when to delegate"
        );
  }

  // ── platform blocks ──
  const present = AGENT_PLATFORMS.filter((p) => (platforms[p]?.length ?? 0) > 0);
  present.length > 0
    ? add("pass", "platforms", `defines block(s): ${present.join(", ")}`)
    : add(
        "warn",
        "platforms",
        "no platform block — the subagent installs with only name/description; add a claude:/opencode:/cursor:/copilot: block to set model, tools, mode"
      );

  if (platforms.claude) checkClaudeBlock(platforms.claude, add);
  if (platforms.opencode) checkOpencodeBlock(platforms.opencode, add);
  if (platforms.cursor) checkCursorBlock(platforms.cursor, add);
  if (platforms.copilot) checkCopilotBlock(platforms.copilot, add);

  // ── skills field: Claude preloads it; the others have no such field ──
  for (const p of ["opencode", "cursor", "copilot"] as const) {
    if (platforms[p] && hasField(platforms[p] ?? [], "skills")) {
      add(
        "warn",
        `${p}.skills`,
        `${p} has no native \`skills\` frontmatter field — it will be ignored; record intended skills in the body instead`
      );
    }
  }

  // ── body ──
  const bodyLines = body.split("\n").length;
  bodyLines <= MAX_BODY_LINES
    ? add("pass", "body.length", `${bodyLines}/${MAX_BODY_LINES} lines`)
    : add(
        "warn",
        "body.length",
        `${bodyLines} lines exceeds ${MAX_BODY_LINES} — trim the system prompt`
      );
  body.trim().length > 0
    ? add("pass", "body.present", "has a system prompt")
    : add(
        "error",
        "body.present",
        "empty body — a subagent needs a system prompt after the frontmatter"
      );

  // ── absolute-path portability ──
  const hits: string[] = [];
  const allLines = readFileSync(file, "utf-8").split("\n");
  for (let i = 0; i < allLines.length; i++) {
    const m = ABSOLUTE_PATH_RE.exec(allLines[i]);
    if (m) hits.push(`${i + 1} → ${m[0]}`);
  }
  const more = hits.length > 3 ? ` (+${hits.length - 3} more)` : "";
  hits.length > 0
    ? add(
        "warn",
        "paths.absolute",
        `hardcoded machine-specific path(s): ${hits.slice(0, 3).join("; ")}${more} — prefer $HOME/~ or an env var`
      )
    : add("pass", "paths.absolute", "no machine-specific absolute paths");

  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.filter((f) => f.level === "warn").length;
  return { file, name, findings, errors, warnings };
}

/** Render a subagent report as a human-readable string. */
export function formatSubagentReport(r: SubagentReport): string {
  const icon = { pass: "✓", warn: "⚠", error: "✗" } as const;
  const lines = [`subagent-doctor: ${r.name ?? "(unparsed)"}  —  ${r.file}`];
  for (const f of r.findings) {
    lines.push(`  ${icon[f.level]} ${f.check}: ${f.message}`);
  }
  let verdict: string;
  if (r.errors > 0) {
    verdict = `FAIL — ${r.errors} error(s), ${r.warnings} warning(s)`;
  } else if (r.warnings > 0) {
    verdict = `OK with ${r.warnings} warning(s)`;
  } else {
    verdict = "PASS — all checks clean";
  }
  lines.push(`  ${verdict}`);
  return lines.join("\n");
}

/** Resolve a doctor argument to a subagent .md path (a path, or a name in the store). */
export function resolveSubagentFile(arg: string): string {
  if (arg.endsWith(".md") && existsSync(resolve(arg))) return resolve(arg);
  const direct = resolve(arg);
  if (existsSync(direct) && direct.endsWith(".md")) return direct;
  return resolve(palHome(), "agents", arg.endsWith(".md") ? arg : `${arg}.md`);
}

if (import.meta.main) {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: bun src/tools/subagent-doctor.ts <file-or-name>");
    process.exit(2);
  }
  const report = lintSubagent(resolveSubagentFile(arg));
  console.log(formatSubagentReport(report));
  process.exit(report.errors > 0 ? 1 : 0);
}

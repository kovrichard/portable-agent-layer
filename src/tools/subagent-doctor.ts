/**
 * subagent-doctor — static evaluator for a personal subagent definition
 * (~/.pal/agents/<name>.md) with merged multi-platform frontmatter. Checks only
 * what is mechanically verifiable: name/description constraints, per-platform
 * blocks (one per agent), model/tools/permission shape, body
 * length, and absolute-path portability.
 *
 * Library:  import { lintSubagent, formatSubagentReport } from ".../subagent-doctor"
 * Script:   bun src/tools/subagent-doctor.ts <file-or-name>
 *           (resolves a path, or a name under ~/.pal/agents/)
 * CLI:      pal cli subagent doctor <name>   (see src/cli/subagent.ts)
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseAgentDefinition } from "../hooks/lib/agent-definition";
import { AGENT_NAMES, type AgentName } from "../hooks/lib/agent-registry";
import { assets, isDirectChild, namesAPath, palHome, toPath } from "../hooks/lib/paths";
import {
  type AddFinding,
  checkAntigravityBlock,
  checkClaudeBlock,
  checkCodexBlock,
  checkCopilotBlock,
  checkCursorBlock,
  checkOpencodeBlock,
  hasField,
  type Level,
  topLevelKeys,
} from "./subagent-platform-checks";

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

interface ParsedSubagent {
  hasFrontmatter: boolean;
  name: string | null;
  description: string | null;
  descriptionQuoted: boolean;
  global: string[];
  platforms: Partial<Record<AgentName, string[]>>;
  body: string;
}

const RESERVED_WORDS = ["anthropic", "claude"];
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_BODY_LINES = 500;
const SHARED_FIELDS = ["name", "description"];

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

/** Real paths, so a relative path, `..` or a link into the shipped folder counts, and nothing else does. */
function isShippedSubagentFile(file: string): boolean {
  const dir = assets.agents();
  if (!existsSync(dir) || !existsSync(file)) return false;

  return isDirectChild(realpathSync(dir), realpathSync(file));
}

/** Split a merged subagent .md into global fields, per-platform blocks, and body. */
function parseSubagent(content: string): ParsedSubagent {
  const definition = parseAgentDefinition(content);
  if (!definition.hasFrontmatter) {
    return { ...definition, name: null, description: null, descriptionQuoted: false };
  }

  const { global, platforms, body } = definition;

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

  checkSubagentName(
    parsed.name,
    basename(file).replace(/\.md$/, ""),
    isShippedSubagentFile(file),
    add
  );
  checkSubagentDescription(parsed, add);
  checkGlobalFields(parsed, add);
  checkPlatformBlocks(parsed.platforms, add);
  checkSubagentBody(parsed.body, add);
  checkSubagentAbsolutePaths(readFileSync(file, "utf-8"), add);

  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.filter((f) => f.level === "warn").length;

  return { file, name: parsed.name, findings, errors, warnings };
}

function checkSubagentName(
  name: string | null,
  stem: string,
  shipped: boolean,
  add: AddFinding
): void {
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
    checkNameCollision(name, shipped, add);
  }
}

function checkNameCollision(name: string, shipped: boolean, add: AddFinding): void {
  if (shipped) {
    add("pass", "name.collision", "is a shipped PAL subagent");
  } else if (shippedAgentNames().has(name)) {
    add(
      "error",
      "name.collision",
      `"${name}" is a shipped PAL subagent — a reinstall would overwrite it; choose another name`
    );
  } else {
    add("pass", "name.collision", "does not collide with a shipped subagent");
  }
}

function checkSubagentDescription(
  { description, descriptionQuoted }: ParsedSubagent,
  add: AddFinding
): void {
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
}

function checkGlobalFields(parsed: ParsedSubagent, add: AddFinding): void {
  const unmappedGlobals = topLevelKeys(parsed.global).filter(
    (key) => !SHARED_FIELDS.includes(key)
  );
  if (unmappedGlobals.length > 0) {
    add(
      "error",
      "global.fields",
      `global ${unmappedGlobals.join(", ")} has no Codex key, so linking fails — move it into the platform blocks that use it`
    );
  }
}

function checkPlatformBlocks(
  platforms: ParsedSubagent["platforms"],
  add: AddFinding
): void {
  const present = AGENT_NAMES.filter((p) => (platforms[p]?.length ?? 0) > 0);
  const blockKeys = AGENT_NAMES.map((p) => p.concat(":")).join("/");
  present.length > 0
    ? add("pass", "platforms", `defines block(s): ${present.join(", ")}`)
    : add(
        "warn",
        "platforms",
        `no platform block — the subagent installs with only name/description; add a ${blockKeys} block to set model, tools, mode`
      );

  if (platforms.claude) checkClaudeBlock(platforms.claude, add);

  if (platforms.opencode) checkOpencodeBlock(platforms.opencode, add);

  if (platforms.cursor) checkCursorBlock(platforms.cursor, add);

  if (platforms.copilot) checkCopilotBlock(platforms.copilot, add);

  if (platforms.codex) checkCodexBlock(platforms.codex, add);

  if (platforms.antigravity) checkAntigravityBlock(platforms.antigravity, add);

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
}

function checkSubagentBody(body: string, add: AddFinding): void {
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
}

function checkSubagentAbsolutePaths(content: string, add: AddFinding): void {
  const hits: string[] = [];
  const allLines = content.split("\n");

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
  const direct = toPath(arg);
  if (existsSync(direct) && direct.endsWith(".md")) return direct;

  if (namesAPath(arg)) return direct.endsWith(".md") ? direct : `${direct}.md`;

  return resolve(palHome(), "agents", arg.endsWith(".md") ? arg : `${arg}.md`);
}

if (import.meta.main) {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: pal cli subagent doctor <file-or-name>");
    process.exit(2);
  }

  const report = lintSubagent(resolveSubagentFile(arg));
  console.log(formatSubagentReport(report));
  process.exit(report.errors > 0 ? 1 : 0);
}

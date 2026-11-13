/**
 * skill-doctor — static evaluator for a SKILL.md against Anthropic's
 * skill-authoring best practices. Checks only what is mechanically verifiable:
 * name/description constraints, body length, point-of-view, and reference depth.
 *
 * Every check is a pure function of a skill's text or its directory listing, so
 * each one is exercised directly rather than through a whole lint run.
 *
 * Script:   bun src/tools/skill-doctor.ts <skill-dir-or-name>
 * CLI:      pal cli skill doctor <name>   (see src/cli/skill.ts)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { palHome, toPath } from "../../hooks/lib/paths";
import {
  findAbsolutePaths,
  leadTriggers,
  type ParsedSkill,
  parseSkill,
  quoteList,
  stripCode,
} from "./skill-parse";

type Level = "pass" | "warn" | "error";

interface DoctorFinding {
  level: Level;
  check: string;
  message: string;
}

export interface DoctorReport {
  dir: string;
  name: string | null;
  findings: DoctorFinding[];
  errors: number;
  warnings: number;
}

const RESERVED_WORDS = ["anthropic", "claude"];
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_BODY_LINES = 500;
const MIN_TRIGGERS = 3;

/**
 * Evaluate the skill at `skillDir` (a folder containing SKILL.md) and return a
 * structured report. Hard rules from Anthropic's validation surface as errors;
 * best-practice nudges surface as warnings.
 */
export function lintSkill(skillDir: string): DoctorReport {
  const findings: DoctorFinding[] = [];
  const add = (level: Level, check: string, message: string) =>
    findings.push({ level, check, message });

  if (!existsSync(skillDir)) {
    add("error", "structure", `No skill directory at ${skillDir}`);

    return { dir: skillDir, name: null, findings, errors: 1, warnings: 0 };
  }

  // The runtime loads only an exact `SKILL.md`, and on macOS and Windows existsSync
  // would also accept `skill.md`, so match the real on-disk entry.
  const skillFile = readdirSync(skillDir).find((e) => e.toLowerCase() === "skill.md");
  if (!skillFile) {
    add("error", "structure", `No SKILL.md found in ${skillDir}`);

    return { dir: skillDir, name: null, findings, errors: 1, warnings: 0 };
  }

  skillFile === "SKILL.md"
    ? add("pass", "file.name", "skill file is named SKILL.md")
    : add(
        "error",
        "file.name",
        `skill file is "${skillFile}" — must be exactly "SKILL.md" or the skill is silently ignored`
      );

  const skill = parseSkill(readFileSync(resolve(skillDir, skillFile), "utf-8"));
  checkProvenance(skill, add);
  checkNameMatchesFolder(skill.name, skillDir, add);
  checkName(skill.name, add);
  checkDescription(skill, add);
  checkTriggers(skill, add);
  checkBody(skill.body, add);
  checkReferenceDepth(skill.body, skillDir, resolve(skillDir, skillFile), add);
  checkWindowsPaths(skill.body, add);
  checkAbsolutePaths(skillDir, add);

  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.filter((f) => f.level === "warn").length;

  return { dir: skillDir, name: skill.name, findings, errors, warnings };
}

type AddFinding = (level: Level, check: string, message: string) => void;

function checkProvenance(skill: ParsedSkill, add: AddFinding): void {
  if (!skill.shipped) return;

  if (skill.license) add("pass", "license", `licensed ${skill.license}`);
  else if (skill.derivedFrom)
    add("pass", "license", `unlicensed by design — derived from ${skill.derivedFrom}`);
  else
    add(
      "warn",
      "license",
      "shipped skill declares no license — add `license: MIT`, or `metadata.derived-from: <origin>` when the idea comes from another project"
    );
}

// The runtime keys a skill by its folder name; a mismatched frontmatter `name`
// makes the skill silently fail to load.
function checkNameMatchesFolder(
  name: string | null,
  skillDir: string,
  add: AddFinding
): void {
  if (!name) return;
  const folder = basename(skillDir);
  name === folder
    ? add("pass", "name.folder", `matches folder "${folder}"`)
    : add(
        "error",
        "name.folder",
        `name "${name}" must equal the folder name "${folder}" verbatim — otherwise the skill is silently ignored`
      );
}

function checkName(name: string | null, add: AddFinding): void {
  if (!name) {
    add("error", "name", "Missing `name` in frontmatter");
  } else {
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
  }
}

function checkDescription(
  { description, descriptionQuoted }: ParsedSkill,
  add: AddFinding
): void {
  if (!description) {
    add("error", "description", "Missing `description` in frontmatter");
  } else {
    checkDescriptionFormat(description, descriptionQuoted, add);
    checkDescriptionWording(description, add);
  }
}

function checkDescriptionFormat(
  description: string,
  descriptionQuoted: boolean,
  add: AddFinding
): void {
  description.length <= MAX_DESCRIPTION
    ? add("pass", "description.length", `${description.length}/${MAX_DESCRIPTION} chars`)
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
        'value is not wrapped in double quotes — unquoted YAML mis-parses on colons, commas, and quotes; wrap it in "..." (escaping any inner " as \\")'
      );
}

function checkDescriptionWording(description: string, add: AddFinding): void {
  /<[^>]+>/.test(description)
    ? add(
        "warn",
        "description.xml",
        "contains angle-bracket content — Anthropic disallows XML tags; rephrase placeholders like <x> in prose"
      )
    : add("pass", "description.xml", "no XML tags");
  /\bwhen/i.test(description)
    ? add("pass", "description.trigger", "states when to use the skill")
    : add(
        "warn",
        "description.trigger",
        "no 'when to use' trigger — add 'Use when …' so the dispatcher can match it"
      );
  /\b(I can|I['’]ll|I will|I help|you can|you will|you could|you['’]ll)\b/i.test(
    description
  )
    ? add(
        "warn",
        "description.pov",
        "reads first/second person — write descriptions in third person (e.g. 'Processes…', 'Generates…')"
      )
    : add("pass", "description.pov", "third person");
}

function checkTriggers({ name, triggers }: ParsedSkill, add: AddFinding): void {
  if (triggers.length === 0) {
    add(
      "warn",
      "metadata.triggers",
      "no metadata.triggers declared — add the words and phrases a prompt would contain so the prompt-time matcher can surface this skill; without them it falls back to keywords mined from the description"
    );
  } else if (triggers.length < MIN_TRIGGERS) {
    add(
      "warn",
      "metadata.triggers",
      `only ${triggers.length} trigger(s) declared — aim for at least ${MIN_TRIGGERS}, mostly multi-word phrases`
    );
  } else {
    add("pass", "metadata.triggers", `${triggers.length} triggers declared`);
  }

  if (name && triggers.length > 0) {
    const lead = leadTriggers(name);
    const actual = triggers.slice(0, lead.length);
    const wanted = quoteList(lead, " then ");
    const found = quoteList(actual, ", ") || "nothing";
    actual.join("\u0000") === lead.join("\u0000")
      ? add("pass", "metadata.triggers.lead", `leads with ${wanted}`)
      : add(
          "warn",
          "metadata.triggers.lead",
          `triggers must lead with ${wanted} — found ${found}`
        );
  }
}

function checkBody(body: string, add: AddFinding): void {
  const bodyLines = body.split("\n").length;
  bodyLines <= MAX_BODY_LINES
    ? add("pass", "body.length", `${bodyLines}/${MAX_BODY_LINES} lines`)
    : add(
        "warn",
        "body.length",
        `${bodyLines} lines exceeds ${MAX_BODY_LINES} — split into reference files`
      );

  const prose = stripCode(body);
  /\b(I['’]m|I will|I['’]ll|in my experience|my workflow|I wrote|I created)\b/i.test(
    prose
  )
    ? add(
        "warn",
        "body.pov",
        "body uses first-person author voice — write it as second-person instructions to the assistant"
      )
    : add("pass", "body.pov", "instructional voice");
}

function checkReferenceDepth(
  body: string,
  skillDir: string,
  skillFilePath: string,
  add: AddFinding
): void {
  const linkRe = /\[[^\]]+\]\(([^)]+\.md)\)/g;
  // A reference back to the entry SKILL.md is a return-link, not a deeper chain.
  const isDeeperRef = (target: string) =>
    !/^https?:/.test(target) && resolve(skillDir, target) !== skillFilePath;
  let nested = false;

  for (const m of body.matchAll(linkRe)) {
    const target = m[1];
    if (!isDeeperRef(target)) continue;
    const targetPath = resolve(skillDir, target);
    if (!existsSync(targetPath)) continue;
    const refContent = readFileSync(targetPath, "utf-8");
    const onward = [...refContent.matchAll(linkRe)]
      .map((mm) => mm[1])
      .filter(isDeeperRef);
    if (onward.length > 0) {
      nested = true;
      add(
        "warn",
        "references.depth",
        `${target} links to further .md files — keep references one level deep from SKILL.md`
      );
    }
  }

  if (!nested) add("pass", "references.depth", "references are one level deep");
}

function checkWindowsPaths(body: string, add: AddFinding): void {
  // Skip lines that are deliberate Windows examples (cmd.exe / %ENV% paths) —
  // a cross-platform skill may legitimately document the Windows invocation.
  const winPathRe = /\b[\w.-]+\\[\w.-]+\.(py|ts|js|sh|md|json)\b/;
  const isIntentionalWindows = (line: string) =>
    /%[A-Z_]+%/.test(line) || /cmd\.exe/i.test(line);
  body.split("\n").some((l) => winPathRe.test(l) && !isIntentionalWindows(l))
    ? add("warn", "paths", "Windows-style backslash path found — use forward slashes")
    : add("pass", "paths", "forward-slash paths");
}

function checkAbsolutePaths(skillDir: string, add: AddFinding): void {
  // A warning, never an error: a personal skill may rightly hardcode a path on
  // this machine, such as a cloud-mounted vault.
  const absHits = findAbsolutePaths(skillDir);
  if (absHits.length > 0) {
    const shown = absHits.slice(0, 3).join("; ");
    const more = absHits.length > 3 ? ` (+${absHits.length - 3} more)` : "";
    add(
      "warn",
      "paths.absolute",
      `hardcoded absolute path(s) that won't be portable across machines: ${shown}${more} — prefer $HOME/~ or an env var, or ignore if this is an intentional machine-specific mount`
    );
  } else {
    add("pass", "paths.absolute", "no machine-specific absolute paths");
  }
}

/** Render a report as a human-readable string. */
/** One scannable line per skill for a whole-store run: verdict plus the checks that fired. */
function folderNameTheReaderPassesBack(dir: string): string {
  return basename(dir).padEnd(20);
}

export function formatSummary(r: DoctorReport): string {
  const fired = (level: Level) =>
    r.findings.filter((f) => f.level === level).map((f) => f.check);
  const name = folderNameTheReaderPassesBack(r.dir);

  if (r.errors > 0) {
    return `✗ ${name} ${r.errors} error(s): ${fired("error").join(", ")}`;
  }

  if (r.warnings > 0) {
    return `⚠ ${name} ${r.warnings} warning(s): ${fired("warn").join(", ")}`;
  }

  return `✓ ${name} clean`;
}

export function formatReport(r: DoctorReport): string {
  const icon = { pass: "✓", warn: "⚠", error: "✗" } as const;
  const lines = [`skill-doctor: ${r.name ?? "(unparsed)"}  —  ${r.dir}`];

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

/**
 * A path when the argument names one, otherwise the skill of that name under
 * ~/.pal/skills. An argument matching neither still resolves as a path, so the
 * report names the directory the caller meant rather than a guess.
 */
export function resolveSkillDir(arg: string): string {
  const asPath = toPath(arg);
  if (existsSync(resolve(asPath, "SKILL.md"))) return asPath;
  const byName = resolve(palHome(), "skills", arg);
  if (existsSync(resolve(byName, "SKILL.md"))) return byName;

  return asPath;
}

/**
 * skill-doctor — static evaluator for a SKILL.md against Anthropic's
 * skill-authoring best practices. Checks only what is mechanically verifiable:
 * name/description constraints, body length, point-of-view, and reference depth.
 *
 * Library:  import { lintSkill, formatReport } from ".../skill-doctor"
 * Script:   bun src/tools/skill-doctor.ts <skill-dir-or-name>
 *           (resolves a path, or a name under ~/.pal/skills/)
 * CLI:      pal cli skill doctor <name>   (see src/cli/skill.ts)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { palHome } from "../hooks/lib/paths";

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

interface ParsedSkill {
  name: string | null;
  description: string | null;
  descriptionQuoted: boolean;
  body: string;
}

const RESERVED_WORDS = ["anthropic", "claude"];
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_BODY_LINES = 500;

/** Split a SKILL.md into frontmatter fields and body. */
function parseSkill(content: string): ParsedSkill {
  const parts = content.split(/^---\s*$/m);
  if (parts.length < 3) {
    return { name: null, description: null, descriptionQuoted: false, body: content };
  }
  const frontmatter = parts[1];
  const body = parts.slice(2).join("---");
  const name = /^name:\s*"?(.+?)"?\s*$/m.exec(frontmatter)?.[1] ?? null;
  const rawDescription = /^description:[ \t]*(.*?)\s*$/m.exec(frontmatter)?.[1] ?? null;
  const descriptionQuoted =
    rawDescription !== null &&
    rawDescription.length >= 2 &&
    rawDescription.startsWith('"') &&
    rawDescription.endsWith('"');
  const description = descriptionQuoted ? rawDescription.slice(1, -1) : rawDescription;
  return { name, description, descriptionQuoted, body };
}

/** Remove fenced and inline code so prose checks don't trip on examples. */
function stripCode(s: string): string {
  return s.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

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

  // The runtime only loads a file named exactly `SKILL.md`. On case-insensitive
  // filesystems (macOS, Windows) `existsSync` would accept `skill.md`, so match
  // the real on-disk entry, not a case-folded path.
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

  const { name, description, descriptionQuoted, body } = parseSkill(
    readFileSync(resolve(skillDir, skillFile), "utf-8")
  );

  // The runtime keys a skill by its folder name; a mismatched frontmatter `name`
  // makes the skill silently fail to load.
  const folder = basename(skillDir);
  if (name) {
    name === folder
      ? add("pass", "name.folder", `matches folder "${folder}"`)
      : add(
          "error",
          "name.folder",
          `name "${name}" must equal the folder name "${folder}" verbatim — otherwise the skill is silently ignored`
        );
  }

  // ── name ──
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
          'value is not wrapped in double quotes — unquoted YAML mis-parses on colons, commas, and quotes; wrap it in "..." (escaping any inner " as \\")'
        );
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

  // ── body ──
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

  // ── reference depth (one level deep) ──
  const linkRe = /\[[^\]]+\]\(([^)]+\.md)\)/g;
  const skillFilePath = resolve(skillDir, skillFile);
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

  // ── windows-style paths ──
  // Skip lines that are deliberate Windows examples (cmd.exe / %ENV% paths) —
  // a cross-platform skill may legitimately document the Windows invocation.
  const winPathRe = /\b[\w.-]+\\[\w.-]+\.(py|ts|js|sh|md|json)\b/;
  const isIntentionalWindows = (line: string) =>
    /%[A-Z_]+%/.test(line) || /cmd\.exe/i.test(line);
  body.split("\n").some((l) => winPathRe.test(l) && !isIntentionalWindows(l))
    ? add("warn", "paths", "Windows-style backslash path found — use forward slashes")
    : add("pass", "paths", "forward-slash paths");

  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.filter((f) => f.level === "warn").length;
  return { dir: skillDir, name, findings, errors, warnings };
}

/** Render a report as a human-readable string. */
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

if (import.meta.main) {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: bun src/tools/skill-doctor.ts <skill-dir-or-name>");
    process.exit(2);
  }
  let dir = resolve(arg);
  if (!existsSync(resolve(dir, "SKILL.md"))) {
    const byName = resolve(palHome(), "skills", arg);
    if (existsSync(resolve(byName, "SKILL.md"))) dir = byName;
  }
  const report = lintSkill(dir);
  console.log(formatReport(report));
  process.exit(report.errors > 0 ? 1 : 0);
}

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
import { basename, extname, relative, resolve } from "node:path";
import { palHome } from "../hooks/lib/paths";
import { declaredTriggers } from "../hooks/lib/skill-triggers";

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
  triggers: string[];
  body: string;
}

const RESERVED_WORDS = ["anthropic", "claude"];
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_BODY_LINES = 500;
const MIN_TRIGGERS = 3;

/** File extensions worth scanning for hardcoded paths (SKILL.md + its scripts). */
const SCANNABLE_EXT = new Set([".md", ".ts", ".js", ".mjs", ".cjs", ".sh", ".py"]);

/** Machine/user-specific absolute paths that will not survive an export to
 * another machine or user: POSIX home dirs and Windows user profiles. Portable
 * forms ($HOME, ~, %USERPROFILE%, env vars) are deliberately not matched. */
const ABSOLUTE_PATH_RE =
  /(?:\/(?:Users|home)\/[A-Za-z0-9._-]+|\/root\/[A-Za-z0-9._-]|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+)/;

/** Collect SKILL.md and sibling script files, skipping vendored/VCS trees. */
function collectSkillFiles(skillDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && SCANNABLE_EXT.has(extname(entry.name))) out.push(full);
    }
  };
  walk(skillDir);
  return out;
}

/** Find machine-specific absolute paths across a skill's files. */
function findAbsolutePaths(skillDir: string): string[] {
  const hits: string[] = [];
  for (const file of collectSkillFiles(skillDir)) {
    const rel = relative(skillDir, file).replaceAll("\\", "/");
    const lines = readFileSync(file, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = ABSOLUTE_PATH_RE.exec(lines[i]);
      if (m) hits.push(`${rel}:${i + 1} → ${m[0]}`);
    }
  }
  return hits;
}

/** Split a SKILL.md into frontmatter fields and body. */
function parseSkill(content: string): ParsedSkill {
  const parts = content.split(/^---\s*$/m);
  if (parts.length < 3) {
    return {
      name: null,
      description: null,
      descriptionQuoted: false,
      triggers: [],
      body: content,
    };
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
  return {
    name,
    description,
    descriptionQuoted,
    triggers: declaredTriggers(frontmatter),
    body,
  };
}

/** Render triggers for a report line: `"a", "b"` or `"a" then "b"`. */
function quoteList(triggers: string[], separator: string): string {
  return triggers.map((trigger) => `"${trigger}"`).join(separator);
}

/**
 * The triggers every skill must declare first: its own name, then the
 * de-hyphenated form a user would actually type. A single-word name has only
 * the one form, and the parser dedupes anyway, so it requires just itself.
 */
function leadTriggers(name: string): string[] {
  const spaced = name.replaceAll("-", " ");
  return spaced === name ? [name] : [name, spaced];
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

  const { name, description, descriptionQuoted, triggers, body } = parseSkill(
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

  // ── triggers ──
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

  // ── machine-specific absolute paths (portability) ──
  // A personal skill MAY legitimately hardcode a machine-specific path (e.g. a
  // cloud-mount vault), so this is a warning, never an error — it flags paths
  // that will not survive being exported to another machine or user.
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

  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.filter((f) => f.level === "warn").length;
  return { dir: skillDir, name, findings, errors, warnings };
}

/** Render a report as a human-readable string. */
/** One scannable line per skill for a whole-store run: verdict plus the checks that fired. */
export function formatSummary(r: DoctorReport): string {
  const fired = (level: Level) =>
    r.findings.filter((f) => f.level === level).map((f) => f.check);
  // The folder name, not the frontmatter name — the folder is what the reader
  // passes back to `pal cli skill doctor <name>`, and a mismatch between the two
  // is itself one of the errors this line reports.
  const name = basename(r.dir).padEnd(20);

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

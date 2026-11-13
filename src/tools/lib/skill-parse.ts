import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { splitFrontmatter } from "../../hooks/lib/frontmatter";
import { declaredTriggers } from "../../hooks/lib/skill-triggers";

export interface ParsedSkill {
  name: string | null;
  description: string | null;
  descriptionQuoted: boolean;
  triggers: string[];
  shipped: boolean;
  license: string | null;
  derivedFrom: string | null;
  body: string;
}

const SHIPPED_SOURCE = "portable-agent-layer";

/** File extensions worth scanning for hardcoded paths (SKILL.md + its scripts). */
const SCANNABLE_EXT = new Set([".md", ".ts", ".js", ".mjs", ".cjs", ".sh", ".py"]);

/** Machine/user-specific absolute paths that will not survive an export to
 * another machine or user: POSIX home dirs and Windows user profiles. Portable
 * forms ($HOME, ~, %USERPROFILE%, env vars) are deliberately not matched. */
const ABSOLUTE_PATH_RE =
  /(?:\/(?:Users|home)\/[A-Za-z0-9._-]+|\/root\/[A-Za-z0-9._-]|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+)/;

/** Collect SKILL.md and sibling script files, skipping vendored/VCS trees. */
export function collectSkillFiles(skillDir: string): string[] {
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
export function findAbsolutePaths(skillDir: string): string[] {
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
export function parseSkill(content: string): ParsedSkill {
  const split = splitFrontmatter(content);
  if (!split) {
    return {
      name: null,
      description: null,
      descriptionQuoted: false,
      triggers: [],
      shipped: false,
      license: null,
      derivedFrom: null,
      body: content,
    };
  }

  const { frontmatter, body } = split;
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
    shipped: metadataField(frontmatter, "source") === SHIPPED_SOURCE,
    license: topLevelField(frontmatter, "license"),
    derivedFrom: metadataField(frontmatter, "derived-from"),
    body,
  };
}

/** Value of a top-level `key:` line in the frontmatter, unquoted. */
export function topLevelField(frontmatter: string, key: string): string | null {
  return (
    new RegExp(String.raw`^${key}:\s*"?(.+?)"?\s*$`, "m").exec(frontmatter)?.[1] ?? null
  );
}

/** Value of an indented `key:` line under the `metadata:` block, unquoted. */
export function metadataField(frontmatter: string, key: string): string | null {
  return (
    new RegExp(String.raw`^[ \t]+${key}:\s*"?(.+?)"?\s*$`, "m").exec(frontmatter)?.[1] ??
    null
  );
}

/** Render triggers for a report line: `"a", "b"` or `"a" then "b"`. */
export function quoteList(triggers: string[], separator: string): string {
  return triggers.map((trigger) => `"${trigger}"`).join(separator);
}

/**
 * The triggers every skill must declare first: its own name, then the
 * de-hyphenated form a user would actually type. A single-word name has only
 * the one form, and the parser dedupes anyway, so it requires just itself.
 */
export function leadTriggers(name: string): string[] {
  const spaced = name.replaceAll("-", " ");

  return spaced === name ? [name] : [name, spaced];
}

/** Remove fenced and inline code so prose checks don't trip on examples. */
export function stripCode(s: string): string {
  return s.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

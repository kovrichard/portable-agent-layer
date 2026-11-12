import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { palHome } from "../hooks/lib/paths";
import { declaredTriggers } from "../hooks/lib/skill-triggers";
import { writeJson } from "./json-file";
import { palSkillsDir } from "./skills";

interface SkillIndexEntry {
  name: string;
  description: string;
  triggers: string[];
}

interface SkillIndex {
  generated: string;
  totalSkills: number;
  skills: Record<string, SkillIndexEntry>;
}

/** Fallback triggers for a skill that declares none: keywords mined from its description. */
function extractTriggers(description: string): string[] {
  // Extract "Use when ..." phrases and key terms
  const triggers = new Set<string>();

  const useWhen = new RegExp(/Use when\s+(.+?)(?:\.|$)/i).exec(description);
  if (useWhen) {
    const words = useWhen[1]
      .toLowerCase()
      .split(/[,\s]+/)
      .filter(
        (w) =>
          w.length > 3 &&
          !["when", "this", "that", "with", "from", "about", "your", "the"].includes(w)
      );

    for (const w of words) triggers.add(w);
  }

  // Extract domain terms from full description
  const terms = description
    .toLowerCase()
    .match(
      /\b(research|analyze|extract|summarize|review|debug|reflect|council|debate|brainstorm|first.principles|security|pdf|youtube|telos|goals|projects|beliefs|challenges|opinion|skill|create)\b/g
    );
  if (terms) for (const t of terms) triggers.add(t);

  return [...triggers];
}

/**
 * Generate skill-index.json from installed skills in ~/.pal/skills/.
 * Called during install after skills are symlinked.
 */
export function generateSkillIndex(): number {
  if (!existsSync(palSkillsDir())) return 0;

  const index: SkillIndex = {
    generated: new Date().toISOString(),
    totalSkills: 0,
    skills: {},
  };

  for (const name of readdirSync(palSkillsDir())) {
    const skillMd = resolve(palSkillsDir(), name, "SKILL.md");
    if (!existsSync(skillMd)) continue;

    try {
      const content = readFileSync(skillMd, "utf-8");
      const fmMatch = new RegExp(/^---\n([\s\S]*?)\n---/).exec(content);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      const nameMatch = new RegExp(/^name:\s*(.+)$/m).exec(fm);
      const descMatch = new RegExp(/^description:\s*"?(.+?)"?\s*$/m).exec(fm);

      if (!nameMatch) continue;

      const skillName = nameMatch[1].trim();
      const description = descMatch?.[1]?.trim() ?? "";

      const declared = declaredTriggers(fm);

      index.skills[skillName] = {
        name: skillName,
        description,
        triggers: declared.length > 0 ? declared : extractTriggers(description),
      };
      index.totalSkills++;
    } catch {
      /* skip unreadable skills */
    }
  }

  // Write to state directory
  const stateDir = resolve(palHome(), "memory", "state");
  mkdirSync(stateDir, { recursive: true });
  writeJson(resolve(stateDir, "skill-index.json"), index);

  return index.totalSkills;
}

#!/usr/bin/env bun
/**
 * skill-doctor — static evaluator for a SKILL.md against Anthropic's
 * skill-authoring best practices.
 *
 * Usage: bun src/tools/skill-doctor.ts <skill-dir-or-name>
 *        (resolves a path, or a name under ~/.pal/skills/)
 *
 * The checks live in src/tools/lib/skill-doctor.ts; this file only turns argv
 * into a report and a report into an exit code.
 */

import { formatReport, lintSkill, resolveSkillDir } from "./lib/skill-doctor";

if (import.meta.main) {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: bun src/tools/skill-doctor.ts <skill-dir-or-name>");
    process.exit(2);
  }
  const report = lintSkill(resolveSkillDir(arg));
  console.log(formatReport(report));
  process.exit(report.errors > 0 ? 1 : 0);
}

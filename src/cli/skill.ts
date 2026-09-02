/**
 * pal cli skill — manage personal skills under ~/.pal/skills/.
 *
 *   pal cli skill link <name>     Link an existing ~/.pal/skills/<name>/ into
 *                                 every installed agent so it is discoverable.
 *   pal cli skill doctor <name>   Evaluate ~/.pal/skills/<name>/ against the
 *                                 skill-authoring best practices.
 *   pal cli skill doctor --all    Evaluate every installed skill, one line each.
 *   pal cli skill author-model    Print the flagship model configured to author
 *                                 skills for the active agent (empty if none).
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { getActiveAgent } from "../hooks/lib/agent";
import { flagshipAuthorModel } from "../hooks/lib/models";
import { palHome } from "../hooks/lib/paths";
import { linkPersonalSkill, log } from "../targets/lib";
import { formatReport, formatSummary, lintSkill } from "../tools/skill-doctor";

/** Directory entries under ~/.pal/skills/ that are real skill folders. */
function installedSkills(): string[] {
  const dir = resolve(palHome(), "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => statSync(resolve(dir, entry)).isDirectory())
    .sort();
}

/** Lint every installed skill, one summary line each. Exits 1 if any has errors. */
function doctorAll(): number {
  const dir = resolve(palHome(), "skills");
  const names = installedSkills();
  if (names.length === 0) {
    log.warn(`No skills found in ${dir}`);
    return 0;
  }

  const reports = names.map((n) => lintSkill(resolve(dir, n)));
  for (const report of reports) console.log(formatSummary(report));

  const failing = reports.filter((r) => r.errors > 0).length;
  const warning = reports.filter((r) => r.errors === 0 && r.warnings > 0).length;
  const clean = reports.length - failing - warning;
  console.log(
    `\n${reports.length} skills — ${failing} failing, ${warning} with warnings, ${clean} clean`
  );
  return failing > 0 ? 1 : 0;
}

export async function runSkill(args: string[]): Promise<number> {
  const [sub, name] = args;

  if (sub === "author-model") {
    const model = flagshipAuthorModel(getActiveAgent());
    if (model) console.log(model);
    return 0;
  }

  if (sub === "doctor") {
    if (name === "--all") return doctorAll();
    if (!name) {
      log.error("Usage: pal cli skill doctor <name|--all>");
      return 1;
    }
    const report = lintSkill(resolve(palHome(), "skills", name));
    console.log(formatReport(report));
    return report.errors > 0 ? 1 : 0;
  }

  if (sub === "link") {
    if (!name) {
      log.error("Usage: pal cli skill link <name>");
      return 1;
    }
    try {
      const linked = linkPersonalSkill(name);
      if (linked.length === 0) {
        log.warn(
          `'${name}' linked to no per-skill agents (none installed). ` +
            "It is still discoverable by opencode via ~/.pal/skills/."
        );
      } else {
        log.success(
          `Linked '${name}' into: ${linked.join(", ")} ` +
            "(opencode: auto via ~/.pal/skills/)"
        );
      }
      return 0;
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e));
      return 1;
    }
  }

  log.error("Usage: pal cli skill <link|doctor|author-model> [name|--all]");
  return 1;
}

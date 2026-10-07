/**
 * pal cli skill — manage personal skills under ~/.pal/skills/. `skill run`
 * exists so a SKILL.md can name a tool instead of a path with a tilde no
 * Windows shell expands.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { getActiveAgent } from "../hooks/lib/agent";
import { flagshipAuthorModel } from "../hooks/lib/models";
import { withPalEnv } from "../hooks/lib/pal-env";
import { isInside, palHome, palPkg } from "../hooks/lib/paths";
import { linkPersonalSkill, log } from "../targets/lib";
import { group, leaf, UsageError } from "../tools/lib/command";
import {
  formatReport,
  formatSummary,
  lintSkill,
  resolveSkillDir,
} from "../tools/lib/skill-doctor";

/** Entry names under ~/.pal/skills/, sorted; dangling links included. */
function skillEntries(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

/** A listed entry that does not exist can only be a symlink whose target is gone. */
function isDanglingLink(path: string): boolean {
  return !existsSync(path);
}

/** Lint every installed skill, one summary line each. Exits 1 if any has errors. */
function doctorAll(): number {
  const dir = resolve(palHome(), "skills");
  const entries = skillEntries(dir);

  for (const name of entries.filter((n) => isDanglingLink(resolve(dir, n)))) {
    log.warn(`Skipped ${name}: link target is gone — run 'pal cli install' to prune it`);
  }

  const names = entries.filter((n) => {
    const path = resolve(dir, n);
    return !isDanglingLink(path) && statSync(path).isDirectory();
  });
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

/** One plain path segment — the containment guarantee for `skill run`. */
function isPlainSegment(part: string): boolean {
  return (
    part.length > 0 && part !== "." && part !== ".." && !new RegExp(/[/\\\0]/).test(part)
  );
}

function toolFileName(tool: string): string {
  return new RegExp(/\.[a-z]+$/).test(tool) ? tool : `${tool}.ts`;
}

function runSkillTool(skill: string, tool: string, toolArgs: string[]): number {
  if (!isPlainSegment(skill) || !isPlainSegment(tool)) {
    log.error("Skill and tool must be plain names — no path separators, no '..'");
    return 1;
  }
  const file = toolFileName(tool);
  const path = resolve(palHome(), "skills", skill, "tools", file);
  if (!existsSync(path)) {
    log.error(`No tool '${file}' in skill '${skill}' — looked in ${path}`);
    return 1;
  }
  const { status } = spawnSync("bun", [path, ...toolArgs], {
    stdio: "inherit",
    env: isShippedTool(path) ? withPalEnv(process.env) : process.env,
  });
  return status ?? 1;
}

/** Real paths, so a personal skill symlinked from elsewhere never passes as shipped. */
function isShippedTool(path: string): boolean {
  const shipped = resolve(palPkg(), "assets", "skills");
  return existsSync(shipped) && isInside(realpathSync(shipped), realpathSync(path));
}

function doctorOne(name: string): number {
  const report = lintSkill(resolveSkillDir(name));
  console.log(formatReport(report));
  return report.errors > 0 ? 1 : 0;
}

function doctor(name: string | undefined, all: boolean): number {
  if (all && name) throw new UsageError("give a skill name or --all, not both");
  if (all) return doctorAll();
  if (!name) throw new UsageError("missing <name> (or --all)");
  return doctorOne(name);
}

function link(name: string): number {
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

export function printAuthorModel(): number {
  const model = flagshipAuthorModel(getActiveAgent());
  if (model) console.log(model);
  return 0;
}

export const skillCommand = group({
  summary: "Manage personal skills under ~/.pal/skills/",
  commands: {
    run: leaf({
      summary:
        "Run ~/.pal/skills/<skill>/tools/<tool>; every later argument goes to the tool",
      args: "<skill> <tool>",
      passThrough: true,
      details:
        "Arguments after <tool> reach the tool untouched; '--' before them is optional.",
      run: ({ positionals, passedThrough }) =>
        runSkillTool(positionals[0], positionals[1], passedThrough),
    }),
    link: leaf({
      summary: "Link ~/.pal/skills/<name>/ into every installed agent",
      args: "<name>",
      run: ({ positionals }) => link(positionals[0]),
    }),
    doctor: leaf({
      summary: "Check a skill against the skill-authoring best practices",
      args: "[name]",
      options: {
        all: {
          type: "boolean",
          description: "Check every installed skill, one line each",
        },
      },
      run: ({ positionals, values }) => doctor(positionals[0], values.all === true),
    }),
    "author-model": leaf({
      summary: "Print the flagship model that authors skills for the active agent",
      run: printAuthorModel,
    }),
  },
});

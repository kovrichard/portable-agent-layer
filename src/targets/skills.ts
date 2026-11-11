import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { AGENT_NAMES, AGENT_REGISTRY, skillsDirOf } from "../hooks/lib/agent-registry";
import { assets, palHome, platform } from "../hooks/lib/paths";
import { reportOnlyOnFailure } from "./bulk-install";
import { log } from "./log";
import { ensureSymlink } from "./symlink";

export const palSkillsDir = () => resolve(palHome(), "skills");

/**
 * Install PAL skills by symlinking:
 *   ~/.pal/skills/<name> → <repo>/assets/skills/<name>  (source of truth)
 *   ~/.claude/skills/<name> → ~/.pal/skills/<name>       (agent discovery)
 *
 * Symlinks mean tools inside skills can import from the repo (src/hooks/lib/*)
 * and everything resolves naturally. Additive — skips skills already installed.
 */
export function copySkills(claudeSkillsDir: string): number {
  const skillsDir = assets.skills();
  if (!existsSync(skillsDir))
    throw new Error(`PAL's skills folder is missing: ${skillsDir}`);

  mkdirSync(palSkillsDir(), { recursive: true });
  mkdirSync(claudeSkillsDir, { recursive: true });
  const linkType = process.platform === "win32" ? "junction" : "dir";
  let count = 0;

  for (const name of pruneStaleSkillLinks(claudeSkillsDir)) {
    log.detail(`Removed stale skill link: ${name}`);
  }

  for (const name of readdirSync(skillsDir)) {
    const srcDir = resolve(skillsDir, name);
    if (!existsSync(resolve(srcDir, "SKILL.md"))) continue;

    const palLink = resolve(palSkillsDir(), name);
    const claudeLink = resolve(claudeSkillsDir, name);
    const linked = reportOnlyOnFailure(`skill ${name}`, () => {
      // ~/.pal/skills/<name> → <repo>/assets/skills/<name>
      ensureSymlink(palLink, srcDir, linkType);
      // ~/.claude/skills/<name> → ~/.pal/skills/<name>
      ensureSymlink(claudeLink, palLink, linkType);
    });
    if (linked) count++;
  }

  // ~/.agents/skills/ → ~/.pal/skills/
  mkdirSync(platform.agentsDir(), { recursive: true });
  ensureSymlink(resolve(platform.agentsDir(), "skills"), palSkillsDir(), linkType);

  return count;
}

/** True when `link` is a symlink whose target no longer exists. */
function isDanglingSymlink(link: string): boolean {
  try {
    return lstatSync(link).isSymbolicLink() && !existsSync(link);
  } catch {
    return false;
  }
}

/** True when the symlink at `link` points at `root` or somewhere beneath it. */
function symlinkPointsInto(link: string, root: string): boolean {
  try {
    const target = resolve(dirname(link), readlinkSync(link));
    return target === root || target.startsWith(root + sep);
  } catch {
    return false;
  }
}

/**
 * Remove discovery links left behind when a shipped skill is renamed or
 * retired. Ownership is read from where a link points, not from metadata:
 * a dead link has no SKILL.md to read, but its target path still says
 * whether PAL created it.
 *
 *   ~/.pal/skills/<name>   → pruned when dangling and pointing into assets/skills/
 *   <agent>/skills/<name>  → pruned when dangling and pointing into ~/.pal/skills/
 *
 * Personal skills are real directories, so they are never candidates, and a
 * user's own symlinks to anywhere else are left alone even when broken.
 */
function pruneStaleSkillLinks(agentSkillsDir: string): string[] {
  const ownedTrees = [
    { dir: palSkillsDir(), root: assets.skills() },
    { dir: agentSkillsDir, root: palSkillsDir() },
  ];
  const removed: string[] = [];
  for (const { dir, root } of ownedTrees) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const link = resolve(dir, name);
      if (!isDanglingSymlink(link) || !symlinkPointsInto(link, root)) continue;
      unlinkSync(link);
      removed.push(name);
    }
  }
  return removed;
}

function perSkillAgentDirs(): { agent: string; dir: string }[] {
  return AGENT_NAMES.filter(
    (agent) => AGENT_REGISTRY[agent].skills === "own-skills-dir"
  ).map((agent) => ({ agent, dir: skillsDirOf(agent) }));
}

/**
 * Link a personal skill that already lives at ~/.pal/skills/<name>/ into every
 * installed agent's skills directory so the agent discovers it. Mirrors the
 * per-skill discovery link copySkills() creates for shipped skills.
 *
 * An agent counts as installed when its skills directory already exists.
 * Returns the agents a discovery link was created for (opencode excluded — it
 * is covered by the whole-dir ~/.agents/skills link).
 */
export function linkPersonalSkill(name: string): string[] {
  const palLink = resolve(palSkillsDir(), name);
  if (!existsSync(resolve(palLink, "SKILL.md"))) {
    throw new Error(`No skill found at ${palLink}/SKILL.md`);
  }
  const linkType = process.platform === "win32" ? "junction" : "dir";
  const linked: string[] = [];
  for (const { agent, dir } of perSkillAgentDirs()) {
    if (!existsSync(dir)) continue; // agent not installed
    ensureSymlink(resolve(dir, name), palLink, linkType);
    linked.push(agent);
  }
  return linked;
}

/**
 * Remove one agent's PAL skill links. ~/.pal/skills/<name> and ~/.agents/skills
 * are shared by every installed agent, so a per-agent uninstall leaves them.
 */
export function removeSkills(agentSkillsDir: string): string[] {
  const skillsDir = assets.skills();
  if (!existsSync(skillsDir)) return [];

  const removed: string[] = [];
  for (const name of readdirSync(skillsDir)) {
    if (!existsSync(resolve(skillsDir, name, "SKILL.md"))) continue;

    try {
      unlinkSync(resolve(agentSkillsDir, name));
    } catch {
      /* already gone */
    }
    removed.push(name);
    log.detail(`Removed skill: ${name}`);
  }

  return removed;
}

/** Count skill subdirectories in ~/.pal/skills/ */
export function countSkills(): number {
  if (!existsSync(palSkillsDir())) return 0;
  try {
    return readdirSync(palSkillsDir()).filter((f) =>
      existsSync(resolve(palSkillsDir(), f, "SKILL.md"))
    ).length;
  } catch {
    return 0;
  }
}

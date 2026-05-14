import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { BUILT_IN_RULES } from "../rules/index";
import type { FlintConfig, FlintRule, RuleEntry, Violation } from "./types";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function resolveFiles(include: string[], root: string): string[] {
  const files = new Set<string>();
  for (const pattern of include) {
    const dir = resolve(root, pattern.split("/**")[0].split("/*")[0]);
    try {
      for (const file of walk(dir)) files.add(file);
    } catch {
      // directory doesn't exist — skip
    }
  }
  return [...files];
}

function matchPattern(relPath: string, pattern: string): boolean {
  const norm = relPath.replaceAll("\\", "/");
  const p = pattern.replaceAll("\\", "/");
  if (p.endsWith("/**")) return norm.startsWith(p.slice(0, -3) + "/");
  if (p.startsWith("**/")) return norm.endsWith(p.slice(2));
  return norm === p || norm.startsWith(p + "/");
}

function applyPatterns(files: string[], patterns: string[], root: string): string[] {
  const includes = patterns.filter((p) => !p.startsWith("!"));
  const excludes = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
  return files.filter((file) => {
    const rel = relative(root, file).replaceAll("\\", "/");
    const included = includes.length === 0 || includes.some((p) => matchPattern(rel, p));
    const excluded = excludes.some((p) => matchPattern(rel, p));
    return included && !excluded;
  });
}

function resolveRule(
  entry: RuleEntry,
  registry: Record<string, FlintRule>
): { rule: FlintRule; include?: string[] } {
  if (typeof entry === "string") {
    const rule = registry[entry];
    if (!rule) throw new Error(`Unknown flint rule: "${entry}"`);
    return { rule };
  }
  if ("check" in entry) return { rule: entry };
  const rule = registry[entry.rule];
  if (!rule) throw new Error(`Unknown flint rule: "${entry.rule}"`);
  return { rule, include: entry.include };
}

export function runFlint(config: FlintConfig, customRules: FlintRule[] = []): Violation[] {
  const registry: Record<string, FlintRule> = customRules.length
    ? { ...BUILT_IN_RULES, ...Object.fromEntries(customRules.map((r) => [r.name, r])) }
    : BUILT_IN_RULES;
  const allFiles = resolveFiles(config.include, config.root);
  const violations: Violation[] = [];

  for (const entry of config.rules) {
    const { rule, include } = resolveRule(entry, registry);
    const files = include ? applyPatterns(allFiles, include, config.root) : allFiles;
    rule.check({ files, root: config.root }, violations);
  }

  return violations;
}

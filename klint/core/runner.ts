import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { BUILT_IN_PLUGINS } from "../plugins/index";
import { BUILT_IN_RULES } from "../rules/index";
import { runArchRules } from "./arch";
import { clearAstCache } from "./ast";
import type {
  KlintConfig,
  KlintRule,
  RuleConfigValue,
  Severity,
  Violation,
} from "./types";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts")) out.push(full.replaceAll("\\", "/"));
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
  if (p.endsWith("/**")) return norm.startsWith(`${p.slice(0, -3)}/`);
  if (p.startsWith("**/")) return norm.endsWith(p.slice(2));
  return norm === p || norm.startsWith(`${p}/`);
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

function resolveSeverity(value: RuleConfigValue): Severity {
  return typeof value === "string" ? value : (value.severity ?? "error");
}

function resolveInclude(value: RuleConfigValue): string[] | undefined {
  return typeof value === "object" ? value.include : undefined;
}

export function runKlint(
  config: KlintConfig,
  customRules: Record<string, KlintRule> = {}
): Violation[] {
  clearAstCache();

  // All plugin implementations are always available by their prefixed names
  const pluginImpls: Record<string, KlintRule> = Object.assign(
    {},
    ...Object.values(BUILT_IN_PLUGINS).map((p) => p.implementations)
  );
  const registry: Record<string, KlintRule> = {
    ...BUILT_IN_RULES,
    ...pluginImpls,
    ...customRules,
  };

  // Plugin defaults applied first; explicit rules take precedence
  const pluginDefaults: Record<string, RuleConfigValue> = {};
  for (const pluginName of config.plugins ?? []) {
    const plugin = BUILT_IN_PLUGINS[pluginName];
    if (!plugin) throw new Error(`Unknown klint plugin: "${pluginName}"`);
    Object.assign(pluginDefaults, plugin.rules);
  }
  const effectiveRules: Record<string, RuleConfigValue> = {
    ...pluginDefaults,
    ...config.rules,
  };

  const allFiles = resolveFiles(config.include, config.root);
  const fileContents = new Map(allFiles.map((f) => [f, readFileSync(f, "utf-8")]));
  const violations: Violation[] = [];

  for (const [ruleName, configValue] of Object.entries(effectiveRules)) {
    const severity = resolveSeverity(configValue);
    if (severity === "off") continue;

    const rule = registry[ruleName];
    if (!rule) throw new Error(`Unknown klint rule: "${ruleName}"`);

    const include = resolveInclude(configValue);
    const files = include ? applyPatterns(allFiles, include, config.root) : allFiles;

    const batch: Omit<Violation, "severity">[] = [];
    rule.check({ files, root: config.root, fileContents }, batch);
    for (const v of batch) violations.push({ ...v, rule: ruleName, severity });
  }

  if (config.arch) {
    violations.push(...runArchRules(config.arch, allFiles, fileContents, config.root));
  }

  return violations;
}

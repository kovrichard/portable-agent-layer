import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUILT_IN_RULES } from "../rules/index";
import type { FlintConfig, FlintRule, Violation } from "./types";

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

export function runFlint(config: FlintConfig): Violation[] {
  const rules: FlintRule[] = config.rules.map((r) => {
    if (typeof r === "string") {
      const rule = BUILT_IN_RULES[r];
      if (!rule) throw new Error(`Unknown flint rule: "${r}"`);
      return rule;
    }
    return r;
  });

  const files = resolveFiles(config.include, config.root);
  const ctx = { files, root: config.root };
  const violations: Violation[] = [];

  for (const rule of rules) {
    rule.check(ctx, violations);
  }

  return violations;
}

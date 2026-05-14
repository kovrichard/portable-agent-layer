export interface Violation {
  file: string;
  line: number;
  rule: string;
}

/** @lintignore — public API for external rule authors; TypeScript infers it from FlintRule.check */
export interface RuleContext {
  files: string[];
  root: string;
}

export interface FlintRule {
  name: string;
  check: (ctx: RuleContext, violations: Violation[]) => void;
}

/** @lintignore — public API for rule authors; referenced through RuleEntry union */
export interface RuleScopedEntry {
  rule: string;
  include: string[];
}

export type RuleEntry = FlintRule | RuleScopedEntry | string;

export interface FlintConfig {
  root: string;
  include: string[];
  rules: RuleEntry[];
}

export const defineRule = (r: FlintRule): FlintRule => r;
/** @lintignore — public API for TypeScript config authors */
export const defineConfig = (c: FlintConfig): FlintConfig => c;

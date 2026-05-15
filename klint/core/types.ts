/** @lintignore */
export interface ViolationFix {
  startLine: number;
  endLine: number;
  replacement: string;
}

export interface Violation {
  file: string;
  line: number;
  rule: string;
  message: string;
  fix?: ViolationFix;
}

/** @lintignore */
export interface RuleContext {
  files: string[];
  root: string;
  fileContents: Map<string, string>;
}

export interface KlintRule {
  name: string;
  check: (ctx: RuleContext, violations: Violation[]) => void;
}

/** @lintignore */
export interface RuleScopedEntry {
  rule: string;
  include: string[];
}

export type RuleEntry = KlintRule | RuleScopedEntry | string;

export interface KlintConfig {
  root: string;
  include: string[];
  rules: RuleEntry[];
}

export const defineRule = (r: KlintRule): KlintRule => r;

/** @lintignore */
export const defineConfig = (c: KlintConfig): KlintConfig => c;

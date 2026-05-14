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

export interface RuleContext {
  files: string[];
  root: string;
}

export interface FlintRule {
  name: string;
  check: (ctx: RuleContext, violations: Violation[]) => void;
}

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
export const defineConfig = (c: FlintConfig): FlintConfig => c;

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

export interface FlintConfig {
  root: string;
  include: string[];
  rules: (FlintRule | string)[];
}

export const defineRule = (r: FlintRule): FlintRule => r;
export const defineConfig = (c: FlintConfig): FlintConfig => c;

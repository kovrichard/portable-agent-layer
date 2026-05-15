interface ViolationFix {
  startLine: number;
  endLine: number;
  replacement: string;
}

export type Severity = "error" | "warn" | "off";

/** @lintignore */
export interface RuleOptions {
  severity?: Severity;
  include?: string[];
}

export type RuleConfigValue = Severity | RuleOptions;

export interface Violation {
  file: string;
  line: number;
  rule: string;
  message: string;
  severity: Severity;
  fix?: ViolationFix;
}

/** @lintignore */
export interface RuleContext {
  files: string[];
  root: string;
  fileContents: Map<string, string>;
}

/** Violation as emitted by a rule — severity is added by the runner. */
export type RawViolation = Omit<Violation, "severity">;

export interface KlintRule {
  name: string;
  check: (ctx: RuleContext, violations: RawViolation[]) => void;
}

/** A named bundle of rules with their default severities. */
export interface KlintPlugin {
  name: string;
  rules: Record<string, RuleConfigValue>;
}

export interface KlintConfig {
  root: string;
  include: string[];
  plugins?: string[];
  rules: Record<string, RuleConfigValue>;
}

export const defineRule = (r: KlintRule): KlintRule => r;

/** @lintignore */
export const defineConfig = (c: KlintConfig): KlintConfig => c;

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

/** A named bundle of rules with their default severities and implementations. */
export interface KlintPlugin {
  name: string;
  /** Default severity for each rule. Keys use the prefixed form e.g. "sonar/rule-name". */
  rules: Record<string, RuleConfigValue>;
  /** Rule implementations keyed by the same prefixed names. */
  implementations: Record<string, KlintRule>;
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

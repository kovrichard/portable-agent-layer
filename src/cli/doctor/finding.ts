/**
 * One thing the doctor looked at. A problem carries the fix as a sentence and,
 * where one exists, the exact command — so a later `--fix` can run it and an
 * agent reading `--json` can propose it.
 */

export type Severity = "fail" | "warn" | "optional" | "ok";

export interface Fix {
  say: string;
  command?: string;
}

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  fix?: Fix;
}

export function passed(id: string, title: string): Finding {
  return { id, severity: "ok", title };
}

export function failing(id: string, title: string, fix?: Fix): Finding {
  return { id, severity: "fail", title, fix };
}

export function warning(id: string, title: string, fix?: Fix): Finding {
  return { id, severity: "warn", title, fix };
}

export function optional(id: string, title: string, fix: Fix): Finding {
  return { id, severity: "optional", title, fix };
}

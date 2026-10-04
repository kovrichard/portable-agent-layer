import type { Finding, Fix, Severity } from "./finding";

export interface DoctorReport {
  version: string;
  agents: string[];
  findings: Finding[];
}

interface RenderOptions {
  verbose: boolean;
  color: boolean;
}

const MARK: Record<Severity, { glyph: string; ansi: string }> = {
  fail: { glyph: "✗", ansi: "\x1b[31m" },
  warn: { glyph: "⚠", ansi: "\x1b[33m" },
  optional: { glyph: "·", ansi: "\x1b[90m" },
  ok: { glyph: "✓", ansi: "\x1b[32m" },
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function fixText(fix: Fix): string {
  return fix.command ? `${fix.say}: ${fix.command}` : fix.say;
}

function headline(report: DoctorReport, passedCount: number): string {
  const agents = report.agents.length > 0 ? report.agents.join(", ") : "no agent";
  return `PAL ${report.version} · ${agents} · ${plural(passedCount, "check")} passed`;
}

function summary(failCount: number, warnCount: number, passedCount: number): string {
  return [
    failCount > 0 ? `${failCount} failing` : "",
    warnCount > 0 ? plural(warnCount, "warning") : "",
    `${plural(passedCount, "check")} passed`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function renderReport(report: DoctorReport, options: RenderOptions): string[] {
  const mark = (severity: Severity) =>
    options.color
      ? `${MARK[severity].ansi}${MARK[severity].glyph}\x1b[0m`
      : MARK[severity].glyph;
  const of = (severity: Severity) =>
    report.findings.filter((finding) => finding.severity === severity);
  const fails = of("fail");
  const warns = of("warn");
  const optionals = of("optional");
  const passes = of("ok");

  const lines = [headline(report, passes.length)];
  if (options.verbose) {
    lines.push("", ...passes.map((finding) => `  ${mark("ok")} ${finding.title}`));
  }
  const problems = [...fails, ...warns];
  if (problems.length > 0) lines.push("");
  for (const problem of problems) {
    lines.push(`  ${mark(problem.severity)} ${problem.title}`);
    if (problem.fix) lines.push(`    → ${fixText(problem.fix)}`);
  }
  if (optionals.length > 0) {
    lines.push("", "Optional — not set up:");
    for (const item of optionals) {
      const how = item.fix?.command ?? item.fix?.say;
      const suffix = how ? `: ${how}` : "";
      lines.push(`  ${mark("optional")} ${item.title}${suffix}`);
    }
  }
  if (problems.length > 0) {
    lines.push("", summary(fails.length, warns.length, passes.length));
  }
  return lines;
}

export function doctorExitCode(findings: Finding[]): 0 | 1 {
  return findings.some((finding) => finding.severity === "fail") ? 1 : 0;
}

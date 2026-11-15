import { logError } from "../../core/log";
import { type HealthSummary, writeHealthSummary } from "../../usage/health-cache";
import type { Finding, Severity } from "./finding";

const LABEL_MAX = 60;

export function findingLabel(title: string): string {
  return title.split(" — ")[0].slice(0, LABEL_MAX);
}

const withSeverity = (findings: Finding[], severity: Severity) =>
  findings.filter((finding) => finding.severity === severity);

export function healthSummary(
  findings: Finding[],
  now: Date = new Date()
): HealthSummary {
  const failing = withSeverity(findings, "fail");

  return {
    checkedAt: now.toISOString(),
    failing: failing.length,
    warnings: withSeverity(findings, "warn").length,
    worst: failing.length > 0 ? findingLabel(failing[0].title) : null,
  };
}

export function saveHealthSummary(
  findings: Finding[],
  write: (summary: HealthSummary) => void = writeHealthSummary
): void {
  try {
    write(healthSummary(findings));
  } catch (err) {
    logError("doctor:health-summary", err);
  }
}

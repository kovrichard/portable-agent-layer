import { getInstalledVersion } from "../../hooks/handlers/update-check";
import { recordDoctorRun } from "../../report/doctor-signal";
import { releaseHealthMarker } from "../../usage/health-cache";
import { createStyle } from "../ui/style";
import {
  agentFindings,
  type DoctorResult,
  detectAgents,
  installedAgents,
  rosterFindings,
} from "./agents";
import { environmentFindings } from "./environment";
import type { Finding, Group } from "./finding";
import { healthFindings } from "./health";
import { inferenceFindings } from "./inference";
import { type DoctorReport, doctorExitCode, renderReport } from "./render";
import { stateFindings } from "./state";
import { saveHealthSummary } from "./summary";

const inGroup = (group: Group, findings: Finding[]) =>
  findings.map((finding) => ({ ...finding, group }));

const healthGroup = (finding: Finding): Group =>
  /^(hook-errors|claude-login)/.test(finding.id) ? "Inference" : "State";

function doctorFindings(health: DoctorResult): Finding[] {
  const agents = installedAgents(health);

  return [
    ...inGroup("Agents", rosterFindings(agents)),
    ...inGroup("Environment", environmentFindings(health.rtk)),
    ...inGroup("State", stateFindings()),
    ...inGroup("Agents", agentFindings(agents)),
    ...inGroup("Inference", inferenceFindings(agents)),
    ...healthFindings().map((finding) => ({ ...finding, group: healthGroup(finding) })),
  ];
}

export function doctorReport(
  health: DoctorResult,
  started = performance.now()
): DoctorReport {
  const findings = doctorFindings(health);
  saveHealthSummary(findings);
  recordDoctorRun(findings);

  return {
    version: getInstalledVersion(),
    agents: installedAgents(health),
    findings,
    elapsedMs: performance.now() - started,
  };
}

export function runBackgroundDoctor(
  report: (health: DoctorResult) => unknown = doctorReport,
  detect: () => DoctorResult = detectAgents
): void {
  try {
    report(detect());
  } finally {
    releaseHealthMarker();
  }
}

/** `pal cli doctor [--verbose] [--json]` — prints the report and returns the exit code. */
export function runDoctor(args: string[], health?: DoctorResult): number {
  if (process.env.PAL_SKIP_DOCTOR === "1") return 0;
  const started = performance.now();
  const report = doctorReport(health ?? detectAgents(), started);

  if (args.includes("--json")) {
    const { elapsedMs: _elapsed, ...json } = report;
    console.log(JSON.stringify(json, null, 2));
  } else {
    const lines = renderReport(report, {
      verbose: args.includes("--verbose"),
      style: createStyle(),
    });
    console.log(lines.join("\n"));
  }

  return doctorExitCode(report.findings);
}

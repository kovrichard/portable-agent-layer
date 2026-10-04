import { getInstalledVersion } from "../../hooks/handlers/update-check";
import {
  agentFindings,
  type DoctorResult,
  detectAgents,
  installedAgents,
  rosterFindings,
} from "./agents";
import { environmentFindings } from "./environment";
import type { Finding } from "./finding";
import { healthFindings } from "./health";
import { inferenceFindings } from "./inference";
import { doctorExitCode, renderReport } from "./render";
import { stateFindings } from "./state";

function doctorFindings(health: DoctorResult): Finding[] {
  const agents = installedAgents(health);
  return [
    ...rosterFindings(agents),
    ...environmentFindings(health.rtk),
    ...stateFindings(),
    ...agentFindings(agents),
    ...inferenceFindings(agents),
    ...healthFindings(),
  ];
}

/** `pal cli doctor [--verbose] [--json]` — prints the report and returns the exit code. */
export function runDoctor(args: string[], health: DoctorResult = detectAgents()): number {
  if (process.env.PAL_SKIP_DOCTOR === "1") return 0;
  const report = {
    version: getInstalledVersion(),
    agents: installedAgents(health),
    findings: doctorFindings(health),
  };
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const lines = renderReport(report, {
      verbose: args.includes("--verbose"),
      color: process.stdout.isTTY === true,
    });
    console.log(lines.join("\n"));
  }
  return doctorExitCode(report.findings);
}

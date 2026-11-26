/**
 * What a report says about the machine, read from an allowlist: nothing else
 * from the machine reaches a report.
 */

import { arch, platform } from "node:os";
import { getActiveAgent } from "../core/agent";
import { readEnvironment } from "../core/environment";
import { raw } from "../core/settings";
import {
  getInstalledVersion,
  isRepoMode,
  updateChannel,
} from "../hooks/handlers/update-check";

export interface ReportMeta {
  palVersion: string;
  channel: string;
  os: string;
  arch: string;
  agent: string;
  bun: string;
  language: string;
  contextOff: string[];
}

function contextTurnedOff(): string[] {
  return Object.entries(raw().dynamicContext ?? {})
    .filter(([, on]) => on === false)
    .map(([key]) => key)
    .sort();
}

export function reportMeta(): ReportMeta {
  return {
    palVersion: getInstalledVersion(),
    channel: isRepoMode() ? "repo" : updateChannel(),
    os: readEnvironment()?.os ?? platform(),
    arch: arch(),
    agent: getActiveAgent(),
    bun: Bun.version,
    language: Intl.DateTimeFormat().resolvedOptions().locale,
    contextOff: contextTurnedOff(),
  };
}

export function renderMeta(meta: ReportMeta): string {
  const rows: [string, string][] = [
    ["PAL", `${meta.palVersion} (${meta.channel})`],
    ["OS", `${meta.os}, ${meta.arch}`],
    ["Agent", meta.agent],
    ["Bun", meta.bun],
    ["Language", meta.language],
    ["Context turned off", meta.contextOff.join(", ") || "none"],
  ];

  return [
    "## Environment",
    "",
    "| | |",
    "|---|---|",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
  ].join("\n");
}

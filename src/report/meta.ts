/**
 * What a report says about the machine, read from an allowlist: nothing else
 * from the machine reaches a report.
 */

import { spawnSync } from "node:child_process";
import { arch, platform } from "node:os";
import { getActiveAgent } from "../core/agent";
import { readEnvironment } from "../core/environment";
import { palPkg } from "../core/paths";
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

type HeadOf = (dir: string) => string;

const shortHead: HeadOf = (dir) => {
  const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: dir,
    encoding: "utf-8",
  });

  return head.status === 0 ? head.stdout.trim() : "";
};

/** A repo checkout's package.json lags its canary releases, so its commit is what names the code that ran. */
export function repoChannel(headOf: HeadOf = shortHead): string {
  const commit = headOf(palPkg());

  return commit ? `repo @ ${commit}` : "repo";
}

export function reportMeta(headOf: HeadOf = shortHead): ReportMeta {
  return {
    palVersion: getInstalledVersion(),
    channel: isRepoMode() ? repoChannel(headOf) : updateChannel(),
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
    ["PAL version", `${meta.palVersion} (${meta.channel})`],
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

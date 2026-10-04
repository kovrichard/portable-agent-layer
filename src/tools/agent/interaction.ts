#!/usr/bin/env bun
/**
 * Interaction report — how the user's turns went, and whether replies changed
 * while a measured label was in the agent's context.
 *
 * Usage: pal cli interaction report [--days N]
 */

import { parseArgs } from "node:util";
import { claimChecksSince } from "../../hooks/lib/claim-log";
import { turnsSince } from "../../hooks/lib/interaction";
import { claimCheckLines, reportLines, summarize } from "../lib/interaction-report";
import { scriptArgs } from "../lib/script-args";

const HELP = `
  PAL Interaction report

  Reads the measured turns in memory/signals/interaction/ (features only, no
  text) and prints turns, channels, reactions, the hints sent, per agent the
  turns, replies filed and hints sent, and for each
  label (short, long, fast, skimming, friction) how the replies written while
  it was active compare with the replies written while none was. Last, the
  replies that claimed a result (memory/signals/claim-checks/), and which of
  them had no command behind the claim or were sent back.

  Usage: pal cli interaction report [--days N]   (default 7)
`;

const DAY_MS = 86_400_000;

export function run(argv: string[] = scriptArgs()) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      days: { type: "string", default: "7" },
    },
  });
  const days = Number(values.days);
  if (values.help || positionals[0] !== "report" || !(days > 0)) {
    console.log(HELP);
    return;
  }
  const since = new Date(Date.now() - days * DAY_MS);
  const events = turnsSince(since);
  const claims = claimCheckLines(claimChecksSince(since));
  for (const line of [...reportLines(summarize(events), days), ...claims])
    console.log(line);
}

if (import.meta.main) run();

#!/usr/bin/env bun
/**
 * Interaction report — how the user's turns went, and whether replies changed
 * while a measured label was in the agent's context.
 *
 * Usage: pal cli interaction report [--days N]
 */

import { claimChecksSince } from "../../hooks/lib/claim-log";
import { turnsSince } from "../../hooks/lib/interaction";
import { group, leaf, runCommand, UsageError } from "../lib/command";
import { claimCheckLines, reportLines, summarize } from "../lib/interaction-report";
import { scriptArgs } from "../lib/script-args";

const DETAILS = `Reads the measured turns in memory/signals/interaction/ (features only, no
text) and prints turns, channels, reactions, the hints sent, per agent the
turns, replies filed and hints sent, and for each label (short, long, fast,
skimming, friction) how the replies written while it was active compare with
the replies written while none was. Last, the replies that claimed a result
(memory/signals/claim-checks/), and which of them had no command behind the
claim or were sent back.`;

const DAY_MS = 86_400_000;

export const command = group({
  summary: "How the user's turns went, and whether replies changed under each label",
  commands: {
    report: leaf({
      summary: "Print the interaction report",
      options: {
        days: {
          type: "string",
          value: "<n>",
          description: "Days to look back (default 7)",
        },
      },
      details: DETAILS,
      run: ({ values }) => printReport(Number(values.days ?? "7")),
    }),
  },
});

export function run(argv: string[] = scriptArgs()): Promise<number> {
  return runCommand(command, argv, ["pal", "cli", "interaction"]);
}

function printReport(days: number): undefined {
  if (!(days > 0)) throw new UsageError("--days must be a positive number");
  const since = new Date(Date.now() - days * DAY_MS);
  const events = turnsSince(since);
  const claims = claimCheckLines(claimChecksSince(since));
  for (const line of [...reportLines(summarize(events), days), ...claims])
    console.log(line);
}

if (import.meta.main) process.exit(await run());

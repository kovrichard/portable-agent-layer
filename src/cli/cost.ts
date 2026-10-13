import { labelOfRuntime } from "../hooks/lib/agent-registry";
import { allEventsSince } from "../hooks/lib/events";
import { leaf } from "../tools/lib/command";
import { efficiency } from "../tools/lib/cost/efficiency";
import { leaderboards } from "../tools/lib/cost/leaderboards";
import { efficiencyLines, leaderboardLines } from "../tools/lib/cost/render";
import { costLines, costMonths } from "../tools/lib/cost-report";
import { ofType } from "../tools/lib/wrapped/year";

function printCost(): undefined {
  const events = allEventsSince(new Date(0));
  const months = costMonths(ofType(events, "model_call"));
  const lines = [
    ...costLines(months, labelOfRuntime),
    ...leaderboardLines(leaderboards(events)),
    ...efficiencyLines(efficiency(events)),
  ];
  for (const line of lines) console.log(line);
}

export const costCommand = leaf({
  summary: "What each month was paid against its API-equivalent cost, per agent",
  run: () => printCost(),
});

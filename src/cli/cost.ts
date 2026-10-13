import { labelOfRuntime } from "../hooks/lib/agent-registry";
import { eventsSince } from "../hooks/lib/events";
import { leaf } from "../tools/lib/command";
import { costLines, costMonths } from "../tools/lib/cost-report";

function printCost(): undefined {
  const months = costMonths(eventsSince("model_call", new Date(0)));
  for (const line of costLines(months, labelOfRuntime)) console.log(line);
}

export const costCommand = leaf({
  summary: "What each month was paid against its API-equivalent cost, per agent",
  run: () => printCost(),
});

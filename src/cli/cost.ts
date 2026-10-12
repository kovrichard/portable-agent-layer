import { AGENT_REGISTRY, type AgentName } from "../hooks/lib/agent-registry";
import { eventsSince } from "../hooks/lib/events";
import { leaf } from "../tools/lib/command";
import { costLines, costMonths } from "../tools/lib/cost-report";

function labelOf(runtime: string): string {
  return AGENT_REGISTRY[runtime as AgentName]?.label ?? runtime;
}

function printCost(): undefined {
  const months = costMonths(eventsSince("model_call", new Date(0)));
  for (const line of costLines(months, labelOf)) console.log(line);
}

export const costCommand = leaf({
  summary: "What each month was paid against its API-equivalent cost, per agent",
  run: () => printCost(),
});

import { leaf, runCommand } from "../tools/lib/command";
import { scriptArgs } from "../tools/lib/script-args";
import { collectUsage } from "../tools/token-cost";
import { createStyle } from "./ui/style";
import { renderUsage } from "./usage-render";

function printUsage(project: string | undefined): undefined {
  for (const line of renderUsage(createStyle(), collectUsage(project))) console.log(line);
}

export const usageCommand = leaf({
  summary: "Summarize every agent's token usage and cost for today, 7 and 30 days",
  options: {
    project: {
      type: "string",
      value: "<name>",
      description: "Only sessions of this project",
    },
  },
  run: ({ values }) => printUsage(values.project),
});

if (import.meta.main)
  process.exit(await runCommand(usageCommand, scriptArgs(), ["pal", "cli", "usage"]));

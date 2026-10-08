/**
 * pal cli subagent — manage personal subagents under ~/.pal/agents/, each one
 * merged definition split per platform on install.
 */

import { installPersonalSubagent, listPersonalSubagents, log } from "../targets/lib";
import { group, leaf } from "../tools/lib/command";
import {
  formatSubagentReport,
  lintSubagent,
  resolveSubagentFile,
} from "../tools/subagent-doctor";
import { printAuthorModel } from "./skill";

function list(): number {
  const names = listPersonalSubagents();
  if (names.length === 0) {
    log.info("No personal subagents in ~/.pal/agents/");
  } else {
    for (const n of names) console.log(n);
  }
  return 0;
}

function doctor(name: string): number {
  const report = lintSubagent(resolveSubagentFile(name));
  console.log(formatSubagentReport(report));
  return report.errors > 0 ? 1 : 0;
}

function link(name: string): number {
  try {
    const installed = installPersonalSubagent(name);
    if (installed.length === 0) {
      log.warn(
        `'${name}' installed into no agents (none installed yet). ` +
          "Run 'pal cli install' first, then re-link."
      );
    } else {
      log.success(`Installed '${name}' into: ${installed.join(", ")}`);
    }
    return 0;
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

export const subagentCommand = group({
  summary: "Manage personal subagents under ~/.pal/agents/",
  commands: {
    link: leaf({
      summary: "Install ~/.pal/agents/<name>.md into every installed agent",
      args: "<name>",
      run: ({ positionals }) => link(positionals[0]),
    }),
    doctor: leaf({
      summary: "Check a subagent against the subagent-authoring best practices",
      args: "<name>",
      run: ({ positionals }) => doctor(positionals[0]),
    }),
    list: leaf({ summary: "List the user-authored subagents", run: list }),
    "author-model": leaf({
      summary: "Print the flagship model that authors subagents for the active agent",
      run: printAuthorModel,
    }),
  },
});

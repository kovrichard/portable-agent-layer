/**
 * pal cli subagent — manage personal subagents under ~/.pal/agents/.
 *
 *   pal cli subagent link <name>     Install ~/.pal/agents/<name>.md into every
 *                                    installed agent (split per platform).
 *   pal cli subagent doctor <name>   Evaluate ~/.pal/agents/<name>.md against the
 *                                    subagent-authoring best practices.
 *   pal cli subagent list            List the user-authored subagents.
 *   pal cli subagent author-model    Print the flagship model configured to author
 *                                    subagents for the active agent (empty if none).
 */

import { getActiveAgent } from "../hooks/lib/agent";
import { flagshipAuthorModel } from "../hooks/lib/models";
import { installPersonalSubagent, listPersonalSubagents, log } from "../targets/lib";
import {
  formatSubagentReport,
  lintSubagent,
  resolveSubagentFile,
} from "../tools/subagent-doctor";

export async function runSubagent(args: string[]): Promise<number> {
  const [sub, name] = args;

  if (sub === "author-model") {
    const model = flagshipAuthorModel(getActiveAgent());
    if (model) console.log(model);
    return 0;
  }

  if (sub === "list") {
    const names = listPersonalSubagents();
    if (names.length === 0) {
      log.info("No personal subagents in ~/.pal/agents/");
    } else {
      for (const n of names) console.log(n);
    }
    return 0;
  }

  if (sub === "doctor") {
    if (!name) {
      log.error("Usage: pal cli subagent doctor <name>");
      return 1;
    }
    const report = lintSubagent(resolveSubagentFile(name));
    console.log(formatSubagentReport(report));
    return report.errors > 0 ? 1 : 0;
  }

  if (sub === "link") {
    if (!name) {
      log.error("Usage: pal cli subagent link <name>");
      return 1;
    }
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

  log.error("Usage: pal cli subagent <link|doctor|list|author-model> [name]");
  return 1;
}

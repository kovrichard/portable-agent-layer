import { readFileSync } from "node:fs";
import { type Identifiers, type Leak, machineIdentifiers } from "../report/leaks";
import {
  declineReport,
  draftReport,
  type Gh,
  listReports,
  readReport,
  reportLeaks,
  type SendOutcome,
  sendReport,
  shownText,
  similarIssues,
} from "../report/report";
import { group, type Leaf, leaf, UsageError } from "../tools/lib/command";

export interface ReportDeps {
  gh?: Gh;
  ids: () => Identifiers;
}

function printLeaks(leaks: Leak[]): void {
  if (leaks.length === 0) {
    console.log("Leak check: nothing found.");

    return;
  }

  console.log(
    `Leak check: ${leaks.length} found. Rewrite these lines; the report cannot be sent until they are gone:`
  );

  for (const leak of leaks)
    console.log(`  line ${leak.line}: ${leak.kind} (${leak.found})`);
}

/** `args: "<id>"` makes the command refuse a call without one. */
const idOf = (positionals: string[]) => positionals[0] as string;

function outcomeText(outcome: Exclude<SendOutcome, { kind: "blocked" }>): string {
  if (outcome.kind === "filed") return `Filed: ${outcome.url}`;

  if (outcome.kind === "browser")
    return `gh is not available. Open this link to file it:\n${outcome.url}`;

  return `gh is not available and the report is too long for a link. Paste ${outcome.file} into a new issue.`;
}

function printOutcome(outcome: SendOutcome): void {
  if (outcome.kind === "blocked") printLeaks(outcome.leaks);
  else console.log(outcomeText(outcome));
}

function draftLeaf(deps: ReportDeps): Leaf {
  return leaf({
    summary:
      "Write a report from agent-written prose; the environment is added and the leak check runs",
    options: {
      title: { type: "string", value: "<text>", description: "The issue title" },
      "body-file": {
        type: "string",
        value: "<path>",
        description: "Markdown: what happened, how to reproduce, cause, fix, tests",
      },
    },
    run: ({ values }) => {
      if (!values.title || !values["body-file"])
        throw new UsageError("Pass --title and --body-file");
      const report = draftReport(
        values.title,
        readFileSync(values["body-file"], "utf-8")
      );
      console.log(
        `Drafted report ${report.id}. Show it to the user: pal cli report show ${report.id}`
      );
      printLeaks(reportLeaks(report, deps.ids()));
    },
  });
}

function showLeaf(deps: ReportDeps): Leaf {
  return leaf({
    summary: "Print a report exactly as it would be sent, and its leak check",
    args: "<id>",
    run: ({ positionals }) => {
      const report = readReport(idOf(positionals));
      console.log(shownText(report));
      printLeaks(reportLeaks(report, deps.ids()));
    },
  });
}

function similarLeaf(deps: ReportDeps): Leaf {
  return leaf({
    summary: "Issues in the PAL repository that may already describe it",
    args: "<id>",
    run: ({ positionals }) => {
      const found = similarIssues(readReport(idOf(positionals)), deps.gh);
      console.log(found.length > 0 ? found.join("\n") : "No similar issues found.");
    },
  });
}

function sendLeaf(deps: ReportDeps): Leaf {
  return leaf({
    summary:
      "Send a report the user approved: a new issue, or a comment on an existing one",
    args: "<id>",
    options: {
      approved: { type: "boolean", description: "The user read the report and said yes" },
      comment: {
        type: "string",
        value: "<issue>",
        description: "Add it to this issue instead",
      },
    },
    run: ({ positionals, values }) => {
      if (!values.approved)
        throw new UsageError(
          "Show the report to the user first; pass --approved once they say yes"
        );
      const report = readReport(idOf(positionals));
      printOutcome(
        sendReport(report, { comment: values.comment, gh: deps.gh, ids: deps.ids() })
      );
    },
  });
}

const listLeaf = leaf({
  summary: "Reports drafted on this machine, and which were sent",
  run: () => {
    for (const report of listReports())
      console.log(`${report.id}  ${report.sent ? "sent" : "draft"}  ${report.title}`);
  },
});

const declineLeaf = leaf({
  summary: "Record that the user chose not to send a report",
  args: "<id>",
  run: ({ positionals }) => declineReport(readReport(idOf(positionals))),
});

export function reportCommandWith(deps: ReportDeps) {
  return group({
    summary: "Anonymous reports to the PAL repository about a bug in PAL itself",
    commands: {
      draft: draftLeaf(deps),
      show: showLeaf(deps),
      similar: similarLeaf(deps),
      send: sendLeaf(deps),
      decline: declineLeaf,
      list: listLeaf,
    },
  });
}

export const reportCommand = reportCommandWith({ ids: machineIdentifiers });

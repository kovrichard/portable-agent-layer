import { readFileSync } from "node:fs";
import { type Identifiers, type Leak, machineIdentifiers } from "../report/leaks";
import { type ReportMeta, reportMeta } from "../report/meta";
import { type Git, gitIn, openPullRequest, type PrOutcome } from "../report/pull-request";
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
import { listSignals, type Signal } from "../report/signals";
import { group, type Leaf, leaf, UsageError } from "../tools/lib/command";

export interface ReportDeps {
  gh?: Gh;
  git?: (dir: string) => Git;
  meta?: () => ReportMeta;
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

function printPrOutcome(outcome: PrOutcome): number {
  if (outcome.kind === "opened") {
    console.log(`Opened: ${outcome.url}`);

    return 0;
  }

  if (outcome.kind === "refused") console.log(outcome.reason);
  else {
    console.log(`In the ${outcome.source}:`);
    printLeaks(outcome.leaks);
  }

  return 1;
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
        readFileSync(values["body-file"], "utf-8"),
        (deps.meta ?? reportMeta)()
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
      pr: {
        type: "boolean",
        description:
          "Open a pull request with the fix committed in a PAL checkout instead of an issue",
      },
      dir: {
        type: "string",
        value: "<path>",
        description: "The PAL checkout holding the fix (default: the current folder)",
      },
    },
    run: ({ positionals, values }) => {
      if (!values.approved)
        throw new UsageError(
          "Show the report to the user first; pass --approved once they say yes"
        );

      if (values.pr && values.comment)
        throw new UsageError("Pass --pr or --comment, not both");
      const report = readReport(idOf(positionals));
      const ids = deps.ids();

      if (values.pr) {
        const git = (deps.git ?? gitIn)(values.dir ?? process.cwd());

        return printPrOutcome(openPullRequest(report, { git, gh: deps.gh, ids }));
      }

      printOutcome(sendReport(report, { comment: values.comment, gh: deps.gh, ids }));

      return 0;
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

const SHADOW_WINDOW_DAYS = 14;

function verdictWord(signal: Signal): string {
  if (signal.trigger !== "message") return "signal";

  if (signal.verdict === null) return "no-verdict";

  return signal.verdict ? "bug" : "no-bug";
}

function signalLine(signal: Signal): string {
  const when = signal.ts.slice(0, 16).replace("T", " ");
  const said = signal.message === null ? "" : `  "${signal.message.slice(0, 160)}"`;

  return `${when}  ${signal.trigger}  ${verdictWord(signal)}  ${signal.surface || "-"}${said}`;
}

function sinceDate(value: string | undefined): Date {
  if (!value) return new Date(Date.now() - SHADOW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const since = new Date(value);
  if (Number.isNaN(since.getTime())) throw new UsageError(`Not a date: ${value}`);

  return since;
}

const signalsLeaf = leaf({
  summary:
    "Shadow signals that PAL itself may be broken (judged messages, doctor checks that stay failed), to label before any may suggest a report",
  options: {
    since: {
      type: "string",
      value: "<date>",
      description: `From this date (default: the last ${SHADOW_WINDOW_DAYS} days)`,
    },
    bugs: { type: "boolean", description: "Only messages judged a PAL bug" },
  },
  run: ({ values }) => {
    const since = sinceDate(values.since);
    const signals = listSignals(since).filter(
      (signal) => !values.bugs || signal.verdict === true
    );
    if (signals.length === 0)
      console.log(`No signals since ${since.toISOString().slice(0, 10)}.`);

    for (const signal of signals) console.log(signalLine(signal));
  },
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
      signals: signalsLeaf,
    },
  });
}

export const reportCommand = reportCommandWith({ ids: machineIdentifiers });

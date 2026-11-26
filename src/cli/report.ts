import { readFileSync } from "node:fs";
import type { Leak } from "../report/leaks";
import {
  declineReport,
  draftReport,
  listReports,
  readReport,
  reportLeaks,
  type SendOutcome,
  sendReport,
  similarIssues,
} from "../report/report";
import { group, leaf, UsageError } from "../tools/lib/command";

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

function requireId(id: string | undefined): string {
  if (!id) throw new UsageError("Name the report: pal cli report list shows them");

  return id;
}

function draft(title: string | undefined, bodyFile: string | undefined): void {
  if (!title || !bodyFile) throw new UsageError("Pass --title and --body-file");
  const report = draftReport(title, readFileSync(bodyFile, "utf-8"));
  console.log(
    `Drafted report ${report.id}. Show it to the user: pal cli report show ${report.id}`
  );
  printLeaks(reportLeaks(report));
}

function show(id: string): void {
  const report = readReport(id);
  console.log(`# ${report.title}\n\n${report.body}`);
  printLeaks(reportLeaks(report));
}

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

export const reportCommand = group({
  summary: "Anonymous reports to the PAL repository about a bug in PAL itself",
  commands: {
    draft: leaf({
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
      run: ({ values }) => draft(values.title, values["body-file"]),
    }),
    list: leaf({
      summary: "Reports drafted on this machine, and which were sent",
      run: () => {
        for (const report of listReports())
          console.log(`${report.id}  ${report.sent ? "sent" : "draft"}  ${report.title}`);
      },
    }),
    decline: leaf({
      summary: "Record that the user chose not to send a report",
      args: "<id>",
      run: ({ positionals }) => declineReport(readReport(requireId(positionals[0]))),
    }),
    show: leaf({
      summary: "Print a report exactly as it would be sent, and its leak check",
      args: "<id>",
      run: ({ positionals }) => show(requireId(positionals[0])),
    }),
    similar: leaf({
      summary: "Issues in the PAL repository that may already describe it",
      args: "<id>",
      run: ({ positionals }) => {
        const found = similarIssues(readReport(requireId(positionals[0])));
        console.log(found.length > 0 ? found.join("\n") : "No similar issues found.");
      },
    }),
    send: leaf({
      summary:
        "Send a report the user approved: a new issue, or a comment on an existing one",
      args: "<id>",
      options: {
        approved: {
          type: "boolean",
          description: "The user read the report and said yes",
        },
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
        printOutcome(
          sendReport(readReport(requireId(positionals[0])), { comment: values.comment })
        );
      },
    }),
  },
});

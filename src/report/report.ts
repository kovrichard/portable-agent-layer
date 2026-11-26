/**
 * A report PAL sends upstream about a bug in itself. It is drafted on this
 * machine, read by the user exactly as it will be sent, and leaves only on the
 * user's approval and only when the leak check finds nothing.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { appendEvent, logQuietly } from "../bronze/events";
import { paths } from "../core/paths";
import { PAL_REPO_URL } from "../core/remote";
import {
  findLeaks,
  type Identifiers,
  type Leak,
  machineIdentifiers,
  withHomeAsTilde,
} from "./leaks";
import { type ReportMeta, renderMeta, reportMeta } from "./meta";

export const UPSTREAM_REPO = PAL_REPO_URL.replace("https://github.com/", "");
export const REPORT_LABEL = "user-report";
export const REPORT_MARK = "Drafted by `pal cli report`";
const REPORT_FOOTER = `---\n${REPORT_MARK} on the reporter's machine and sent on their approval. A workflow in this repository may label it \`${REPORT_LABEL}\`.`;
const URL_BODY_LIMIT = 6000;

export interface Report {
  id: string;
  title: string;
  body: string;
  created: string;
  sent?: string;
}

interface GhResult {
  ok: boolean;
  out: string;
}

export type Gh = (args: string[]) => GhResult;

const runGh: Gh = (args) => {
  const res = spawnSync("gh", args, { encoding: "utf-8" });

  return { ok: res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim() };
};

const reportsDir = () => resolve(paths.state(), "reports");
const reportFile = (id: string) => resolve(reportsDir(), `${id}.json`);

function nextId(): string {
  return `${new Date().toISOString().slice(0, 10)}-${listReports().length + 1}`;
}

function logReport(
  action: string,
  report: Report,
  extra: Record<string, unknown> = {}
): void {
  logQuietly("upstream_report", () =>
    appendEvent("upstream_report", { action, report: report.id, ...extra })
  );
}

export function readReport(id: string): Report {
  if (!existsSync(reportFile(id)))
    throw new Error(`No report "${id}" in ${reportsDir()}`);

  try {
    return JSON.parse(readFileSync(reportFile(id), "utf-8")) as Report;
  } catch {
    throw new Error(`Report "${id}" is not valid JSON: ${reportFile(id)}`);
  }
}

export function listReports(): Report[] {
  const dir = reportsDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readReport(name.slice(0, -5)));
}

export function declineReport(report: Report): void {
  logReport("declined", report);
}

function saveReport(report: Report): void {
  mkdirSync(reportsDir(), { recursive: true });
  writeFileSync(reportFile(report.id), `${JSON.stringify(report, null, 2)}\n`);
}

export function draftReport(
  title: string,
  prose: string,
  meta: ReportMeta = reportMeta(),
  home: string = homedir()
): Report {
  const body = `${withHomeAsTilde(prose.trim(), home)}\n\n${renderMeta(meta)}\n\n${REPORT_FOOTER}\n`;
  const report = {
    id: nextId(),
    title: withHomeAsTilde(title, home),
    body,
    created: new Date().toISOString(),
  };
  saveReport(report);
  logReport("drafted", report);

  return report;
}

export function reportLeaks(
  report: Report,
  ids: Identifiers = machineIdentifiers()
): Leak[] {
  return findLeaks(shownText(report), ids);
}

/** What `pal cli report show` prints, so a leak's line number points into it. */
export const shownText = (report: Report) => `# ${report.title}\n\n${report.body}`;

function searchTerms(title: string): string {
  return title
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 6)
    .join(" ");
}

export function similarIssues(report: Report, gh: Gh = runGh): string[] {
  const res = gh([
    "issue",
    "list",
    "-R",
    UPSTREAM_REPO,
    "--state",
    "all",
    "--limit",
    "5",
    "--search",
    searchTerms(report.title),
    "--json",
    "number,title,url",
    "--jq",
    '.[] | "#\\(.number) \\(.title) \\(.url)"',
  ]);

  return res.ok && res.out ? res.out.split("\n") : [];
}

export function newIssueUrl(report: Report): string | null {
  if (report.body.length > URL_BODY_LIMIT) return null;
  const query = new URLSearchParams({
    title: report.title,
    body: report.body,
    labels: REPORT_LABEL,
  });

  return `${PAL_REPO_URL}/issues/new?${query}`;
}

export type SendOutcome =
  | { kind: "blocked"; leaks: Leak[] }
  | { kind: "filed"; url: string }
  | { kind: "browser"; url: string }
  | { kind: "manual"; file: string };

function fileWithGh(report: Report, gh: Gh, comment?: string): GhResult {
  const bodyFile = `${reportFile(report.id)}.md`;
  writeFileSync(bodyFile, `${report.body}`);

  if (comment)
    return gh([
      "issue",
      "comment",
      comment,
      "-R",
      UPSTREAM_REPO,
      "--body-file",
      bodyFile,
    ]);

  return gh([
    "issue",
    "create",
    "-R",
    UPSTREAM_REPO,
    "--title",
    report.title,
    "--body-file",
    bodyFile,
    "--label",
    REPORT_LABEL,
  ]);
}

function withoutGh(report: Report): SendOutcome {
  const url = newIssueUrl(report);
  if (url) return { kind: "browser", url };
  writeFileSync(`${reportFile(report.id)}.md`, report.body);

  return { kind: "manual", file: `${reportFile(report.id)}.md` };
}

export function sendReport(
  report: Report,
  options: { comment?: string; gh?: Gh; ids?: Identifiers } = {}
): SendOutcome {
  const leaks = reportLeaks(report, options.ids);
  if (leaks.length > 0) {
    logReport("blocked", report, { leaks: leaks.length });

    return { kind: "blocked", leaks };
  }

  const gh = options.gh ?? runGh;
  const filed = gh(["auth", "status"]).ok
    ? fileWithGh(report, gh, options.comment)
    : null;
  const outcome: SendOutcome = filed?.ok
    ? { kind: "filed", url: filed.out.split("\n").at(-1) ?? "" }
    : withoutGh(report);

  saveReport({ ...report, sent: new Date().toISOString() });
  logReport("sent", report, { via: outcome.kind });

  return outcome;
}

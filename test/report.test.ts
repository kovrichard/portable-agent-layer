import { beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { eventsSince } from "../src/bronze/events";
import type { Identifiers } from "../src/report/leaks";
import type { ReportMeta } from "../src/report/meta";
import { renderMeta, reportMeta } from "../src/report/meta";
import {
  declineReport,
  draftReport,
  type Gh,
  listReports,
  newIssueUrl,
  REPORT_LABEL,
  readReport,
  sendReport,
  UPSTREAM_REPO,
} from "../src/report/report";
import { freshTestDir } from "./lib/test-home";

const META: ReportMeta = {
  palVersion: "0.118.0",
  channel: "canary",
  os: "Ubuntu 26.04 LTS",
  arch: "x64",
  agent: "claude",
  bun: "1.4.4",
  language: "en-US",
  contextOff: [],
};
const IDS: Identifiers = {
  home: "/home/ada",
  words: [{ kind: "project", value: "acme-billing" }],
};

beforeEach(() => {
  process.env.PAL_HOME = resolve(freshTestDir(import.meta.file), "home");
});

function fakeGh(authed: boolean): { gh: Gh; calls: string[][] } {
  const calls: string[][] = [];
  const gh: Gh = (args) => {
    calls.push(args);

    if (args[0] === "auth") return { ok: authed, out: "" };

    return { ok: true, out: "https://github.com/x/y/issues/9" };
  };

  return { gh, calls };
}

const draft = (prose = "## What happened\nThe hook crashed in /home/ada/x.") =>
  draftReport("Hook crashes", prose, META, "/home/ada");

describe("drafting", () => {
  test("rewrites the home path and appends the environment", () => {
    const report = draft();

    expect(report.body).toContain("crashed in ~/x.");
    expect(report.body).toContain("| PAL | 0.118.0 (canary) |");
    expect(readReport(report.id)).toEqual(report);
    expect(listReports().map((r) => r.id)).toEqual([report.id]);
  });

  test("the environment holds only the allowlisted fields", () => {
    expect(Object.keys(reportMeta()).sort()).toEqual(Object.keys(META).sort());
    expect(
      renderMeta(META)
        .split("\n")
        .filter((line) => line.startsWith("| ") && !line.startsWith("| |"))
    ).toHaveLength(6);
  });
});

describe("sending", () => {
  test("a report with a leak is blocked and nothing is called", () => {
    const { gh, calls } = fakeGh(true);
    const outcome = sendReport(draft("It broke in acme-billing."), { gh, ids: IDS });

    expect(outcome.kind).toBe("blocked");
    expect(calls).toEqual([]);
  });

  test("files a labelled issue in the PAL repository through gh", () => {
    const { gh, calls } = fakeGh(true);
    const outcome = sendReport(draft(), { gh, ids: IDS });

    expect(outcome).toEqual({ kind: "filed", url: "https://github.com/x/y/issues/9" });
    expect(calls[1]).toEqual(
      expect.arrayContaining(["create", "-R", UPSTREAM_REPO, "--label", REPORT_LABEL])
    );
    expect(readReport(listReports()[0].id).sent).toBeDefined();
  });

  test("adds it to an existing issue when asked", () => {
    const { gh, calls } = fakeGh(true);
    sendReport(draft(), { gh, ids: IDS, comment: "375" });

    expect(calls[1].slice(0, 3)).toEqual(["issue", "comment", "375"]);
  });

  test("without gh it hands over a prefilled link", () => {
    const { gh, calls } = fakeGh(false);
    const outcome = sendReport(draft(), { gh, ids: IDS });

    expect(outcome.kind).toBe("browser");
    expect(calls).toHaveLength(1);
  });

  test("a report too long for a link is left as a file to paste", () => {
    const report = draft("x".repeat(7000));

    expect(newIssueUrl(report)).toBeNull();
    expect(sendReport(report, { gh: fakeGh(false).gh, ids: IDS }).kind).toBe("manual");
  });

  test("drafts, sends, blocks and declines land in the event log", () => {
    const report = draft();
    sendReport(draft("acme-billing"), { gh: fakeGh(true).gh, ids: IDS });
    declineReport(report);

    expect(eventsSince("upstream_report", new Date(0)).map((e) => e.action)).toEqual([
      "drafted",
      "drafted",
      "blocked",
      "declined",
    ]);
  });
});

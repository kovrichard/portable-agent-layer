import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAL_REPO_URL } from "../src/core/remote";
import { reload } from "../src/core/settings";
import { type ReportMeta, renderMeta, reportMeta } from "../src/report/meta";
import {
  draftReport,
  type Gh,
  newIssueUrl,
  REPORT_LABEL,
  readReport,
  sendReport,
  similarIssues,
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
  contextOff: ["gitState", "agenda"],
};
const IDS = { home: "/home/ada", words: [] };
let HOME: string;

beforeEach(() => {
  HOME = resolve(freshTestDir(import.meta.file), "home");
  process.env.PAL_HOME = HOME;
  reload();
});

const draft = (title = "Hook crashes", prose = "It broke.") =>
  draftReport(title, prose, META, "/home/ada");

function recordingGh(answer: { ok: boolean; out: string }) {
  const calls: string[][] = [];
  const gh: Gh = (args) => {
    calls.push(args);

    return args[0] === "auth" ? { ok: true, out: "" } : answer;
  };

  return { gh, calls };
}

describe("the environment table", () => {
  test("renders every row in order", () => {
    expect(renderMeta(META)).toBe(
      [
        "## Environment",
        "",
        "| | |",
        "|---|---|",
        "| PAL version | 0.118.0 (canary) |",
        "| OS | Ubuntu 26.04 LTS, x64 |",
        "| Agent | claude |",
        "| Bun | 1.4.4 |",
        "| Language | en-US |",
        "| Context turned off | gitState, agenda |",
      ].join("\n")
    );
    expect(renderMeta({ ...META, contextOff: [] })).toContain(
      "| Context turned off | none |"
    );
  });

  test("lists the context sources turned off in settings, sorted", () => {
    mkdirSync(resolve(HOME, "memory"), { recursive: true });
    writeFileSync(
      resolve(HOME, "memory", "pal-settings.json"),
      JSON.stringify({ dynamicContext: { zeta: false, alpha: false, beta: true } })
    );
    reload();

    expect(reportMeta().contextOff).toEqual(["alpha", "zeta"]);
  });
});

describe("reports on disk", () => {
  test("ids count up per day", () => {
    const first = draft();
    const second = draft();

    expect(first.id).toMatch(/^\d{4}-\d{2}-\d{2}-1$/);
    expect(second.id).toBe(`${first.id.slice(0, -1)}2`);
  });

  test("a missing or broken report says which", () => {
    expect(() => readReport("nope")).toThrow('No report "nope" in ');
    const report = draft();
    writeFileSync(resolve(HOME, "state", "reports", `${report.id}.json`), "{broken");

    expect(() => readReport(report.id)).toThrow(
      `Report "${report.id}" is not valid JSON`
    );
  });
});

describe("similarIssues", () => {
  test("searches the PAL repository with the title's longer words", () => {
    const { gh, calls } = recordingGh({ ok: true, out: "#1 a\n#2 b" });

    expect(
      similarIssues(draft("Stop-hook crashes: the guard's (big) regex is off"), gh)
    ).toEqual(["#1 a", "#2 b"]);
    expect(calls[0]).toEqual([
      "issue",
      "list",
      "-R",
      UPSTREAM_REPO,
      "--state",
      "all",
      "--limit",
      "5",
      "--search",
      "Stop-hook crashes guard regex",
      "--json",
      "number,title,url",
      "--jq",
      '.[] | "#\\(.number) \\(.title) \\(.url)"',
    ]);
  });

  test("finds nothing when gh fails or prints nothing", () => {
    expect(similarIssues(draft(), recordingGh({ ok: false, out: "#1 a" }).gh)).toEqual(
      []
    );
    expect(similarIssues(draft(), recordingGh({ ok: true, out: "" }).gh)).toEqual([]);
  });
});

describe("sending", () => {
  test("the prefilled link carries title, body and label", () => {
    const report = draft();
    const url = new URL(newIssueUrl(report) as string);

    expect(`${url.origin}${url.pathname}`).toBe(`${PAL_REPO_URL}/issues/new`);
    expect(url.searchParams.get("title")).toBe("Hook crashes");
    expect(url.searchParams.get("body")).toBe(report.body);
    expect(url.searchParams.get("labels")).toBe(REPORT_LABEL);
  });

  test("gh gets the body as a file, and the filed link is gh's last line", () => {
    const { gh, calls } = recordingGh({ ok: true, out: "Creating…\nhttps://x/issues/9" });
    const report = draft();

    expect(sendReport(report, { gh, ids: IDS })).toEqual({
      kind: "filed",
      url: "https://x/issues/9",
    });
    const bodyFile = calls[1][calls[1].indexOf("--body-file") + 1];
    expect(readFileSync(bodyFile, "utf-8")).toBe(report.body);
    expect(calls[1].slice(0, 6)).toEqual([
      "issue",
      "create",
      "-R",
      UPSTREAM_REPO,
      "--title",
      "Hook crashes",
    ]);
  });

  test("a comment names the issue, the repository and the body file", () => {
    const { gh, calls } = recordingGh({ ok: true, out: "u" });
    sendReport(draft(), { gh, ids: IDS, comment: "375" });

    expect(calls[1].slice(0, 6)).toEqual([
      "issue",
      "comment",
      "375",
      "-R",
      UPSTREAM_REPO,
      "--body-file",
    ]);
  });

  test("a failed gh call falls back to the link", () => {
    const { gh } = recordingGh({ ok: false, out: "boom" });

    expect(sendReport(draft(), { gh, ids: IDS }).kind).toBe("browser");
  });

  test("the file left to paste holds the body", () => {
    const report = draft("Long", "x".repeat(7000));
    const outcome = sendReport(report, { gh: () => ({ ok: false, out: "" }), ids: IDS });

    expect(outcome.kind).toBe("manual");
    expect(outcome.kind === "manual" && readFileSync(outcome.file, "utf-8")).toBe(
      report.body
    );
  });
});

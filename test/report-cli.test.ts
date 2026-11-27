import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { eventsSince } from "../src/bronze/events";
import { reportCommandWith } from "../src/cli/report";
import type { Identifiers } from "../src/report/leaks";
import type { ReportMeta } from "../src/report/meta";
import type { Git } from "../src/report/pull-request";
import { draftReport, type Gh, listReports, readReport } from "../src/report/report";
import { runCommand } from "../src/tools/lib/command";
import { freshTestDir } from "./lib/test-home";

const META: ReportMeta = {
  palVersion: "0.118.0",
  channel: "repo @ abc1234",
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
let DIR: string;

beforeEach(() => {
  DIR = freshTestDir(import.meta.file);
  process.env.PAL_HOME = resolve(DIR, "home");
});

function ghAnswering(authed: boolean, out: string): { gh: Gh; calls: string[][] } {
  const calls: string[][] = [];
  const gh: Gh = (args) => {
    calls.push(args);

    return args[0] === "auth" ? { ok: authed, out: "" } : { ok: true, out };
  };

  return { gh, calls };
}

async function run(
  args: string[],
  gh?: Gh,
  git?: (dir: string) => Git
): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const capture = (...parts: unknown[]) => {
    lines.push(parts.join(" "));
  };
  const log = spyOn(console, "log").mockImplementation(capture);
  const error = spyOn(console, "error").mockImplementation(capture);
  const write = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));

    return true;
  });

  try {
    const deps = { gh, git, meta: () => META, ids: () => IDS };
    const code = await runCommand(reportCommandWith(deps), args, [
      "pal",
      "cli",
      "report",
    ]);

    return { code, out: lines.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
    write.mockRestore();
  }
}

function bodyFile(text: string): string {
  const file = resolve(DIR, "body.md");
  writeFileSync(file, text);

  return file;
}

const drafted = (prose = "## What happened\nThe hook crashed.") =>
  draftReport("Hook crashes", prose, META, "/home/ada");

describe("pal cli report", () => {
  test("draft writes the report and says the leak check found nothing", async () => {
    const { code, out } = await run([
      "draft",
      "--title",
      "Hook crashes",
      "--body-file",
      bodyFile("It broke."),
    ]);

    expect(code).toBe(0);
    expect(out).toContain(
      `Drafted report ${listReports()[0].id}. Show it to the user: pal cli report show`
    );
    expect(out).toContain("Leak check: nothing found.");
  });

  test("draft names each leaked line", async () => {
    const { out } = await run([
      "draft",
      "--title",
      "T",
      "--body-file",
      bodyFile("fine\nin acme-billing"),
    ]);

    expect(out).toContain(
      "Leak check: 1 found. Rewrite these lines; the report cannot be sent until they are gone:"
    );
    expect(out).toContain("  line 4: project (acme-billing)");
  });

  test("draft without a title or body file is a usage error", async () => {
    const { code, out } = await run(["draft", "--title", "T"]);

    expect(code).not.toBe(0);
    expect(out).toContain("Pass --title and --body-file");
  });

  test("show prints the title, the body and the leak check", async () => {
    const report = drafted();
    const { out } = await run(["show", report.id]);

    expect(out).toContain(`# Hook crashes\n\n${report.body}`);
    expect(out).toContain("Leak check: nothing found.");
  });

  test("a verb without an id is refused", async () => {
    const { code, out } = await run(["show"]);

    expect(code).not.toBe(0);
    expect(out).toContain("missing <id>");
  });

  test("similar lists what gh found, or says nothing was found", async () => {
    const report = drafted();

    expect(
      (
        await run(
          ["similar", report.id],
          ghAnswering(true, "#375 Collector logs twice").gh
        )
      ).out
    ).toContain("#375 Collector logs twice");
    expect((await run(["similar", report.id], ghAnswering(true, "").gh)).out).toContain(
      "No similar issues found."
    );
  });

  test("send refuses without --approved and calls nothing", async () => {
    const { gh, calls } = ghAnswering(true, "url");
    const { code, out } = await run(["send", drafted().id], gh);

    expect(code).not.toBe(0);
    expect(out).toContain(
      "Show the report to the user first; pass --approved once they say yes"
    );
    expect(calls).toEqual([]);
  });

  test("send files it and prints the issue link", async () => {
    const report = drafted();
    const { out } = await run(
      ["send", report.id, "--approved"],
      ghAnswering(true, "https://github.com/x/y/issues/9").gh
    );

    expect(out).toContain("Filed: https://github.com/x/y/issues/9");
    expect(readReport(report.id).sent).toBeDefined();
  });

  test("send --comment adds it to that issue", async () => {
    const { gh, calls } = ghAnswering(true, "https://github.com/x/y/issues/375#c");
    await run(["send", drafted().id, "--approved", "--comment", "375"], gh);

    expect(calls[1].slice(0, 3)).toEqual(["issue", "comment", "375"]);
  });

  test("send without gh prints a prefilled link, or the file to paste", async () => {
    const short = await run(
      ["send", drafted().id, "--approved"],
      ghAnswering(false, "").gh
    );
    const long = await run(
      ["send", drafted("x".repeat(7000)).id, "--approved"],
      ghAnswering(false, "").gh
    );

    expect(short.out).toContain(
      "gh is not available. Open this link to file it:\nhttps://github.com/"
    );
    expect(long.out).toContain(
      "gh is not available and the report is too long for a link. Paste "
    );
    expect(long.out).toContain(" into a new issue.");
  });

  test("send prints the leaks instead of sending", async () => {
    const { gh, calls } = ghAnswering(true, "url");
    const { out } = await run(["send", drafted("in acme-billing").id, "--approved"], gh);

    expect(out).toContain("  line 3: project (acme-billing)");
    expect(calls).toEqual([]);
  });

  describe("send --pr", () => {
    function gitAnswering(commits: string, dirs: string[] = []) {
      return (dir: string): Git => {
        dirs.push(dir);

        return (args) => ({ ok: true, out: args[0] === "log" ? commits : "" });
      };
    }

    const ghForPr: Gh = (args) => ({
      ok: true,
      out: args[0] === "api" ? "ada" : "https://github.com/x/y/pull/7",
    });

    test("opens a pull request from the checkout in --dir", async () => {
      const dirs: string[] = [];
      const { code, out } = await run(
        ["send", drafted().id, "--approved", "--pr", "--dir", "/work/pal"],
        ghForPr,
        gitAnswering("fix: the crash", dirs)
      );

      expect(code).toBe(0);
      expect(out).toContain("Opened: https://github.com/x/y/pull/7");
      expect(dirs).toEqual(["/work/pal"]);
    });

    test("without --dir it uses the current folder", async () => {
      const dirs: string[] = [];
      await run(
        ["send", drafted().id, "--approved", "--pr"],
        ghForPr,
        gitAnswering("fix", dirs)
      );

      expect(dirs).toEqual([process.cwd()]);
    });

    test("says why it refused, and fails", async () => {
      const { code, out } = await run(
        ["send", drafted().id, "--approved", "--pr"],
        ghForPr,
        gitAnswering("")
      );

      expect(code).toBe(1);
      expect(out).toContain("No commits ahead of canary: commit the fix first.");
    });

    test("names where the leak is, and fails", async () => {
      const { code, out } = await run(
        ["send", drafted().id, "--approved", "--pr"],
        ghForPr,
        gitAnswering("fix: crash in acme-billing")
      );

      expect(code).toBe(1);
      expect(out).toContain("In the commits:");
      expect(out).toContain("  line 1: project (acme-billing)");
    });

    test("--pr and --comment together are a usage error", async () => {
      const { code, out } = await run(
        ["send", drafted().id, "--approved", "--pr", "--comment", "375"],
        ghForPr,
        gitAnswering("fix")
      );

      expect(code).not.toBe(0);
      expect(out).toContain("Pass --pr or --comment, not both");
    });
  });

  test("list shows each report as draft or sent", async () => {
    const report = drafted();
    await run(["send", drafted().id, "--approved"], ghAnswering(true, "u").gh);
    const { out } = await run(["list"]);

    expect(out).toContain(`${report.id}  draft  Hook crashes`);
    expect(out).toContain("  sent  Hook crashes");
  });

  test("decline records the no in the event log", async () => {
    await run(["decline", drafted().id]);

    expect(eventsSince("upstream_report", new Date(0)).map((e) => e.action)).toContain(
      "declined"
    );
  });

  test("help describes every verb and option", async () => {
    const group = (await run(["--help"])).out;
    const send = (await run(["send", "--help"])).out;
    const draft = (await run(["draft", "--help"])).out;

    for (const text of [
      "Anonymous reports to the PAL repository about a bug in PAL itself",
      "Write a report from agent-written prose; the environment is added and the leak check runs",
      "Print a report exactly as it would be sent, and its leak check",
      "Issues in the PAL repository that may already describe it",
      "Send a report the user approved: a new issue, or a comment on an existing one",
      "Reports drafted on this machine, and which were sent",
      "Record that the user chose not to send a report",
    ])
      expect(group).toContain(text);

    expect(send).toContain("The user read the report and said yes");
    expect(send).toContain("Add it to this issue instead");
    expect(send).toContain(
      "Open a pull request with the fix committed in a PAL checkout instead of an issue"
    );
    expect(send).toContain(
      "The PAL checkout holding the fix (default: the current folder)"
    );
    expect(draft).toContain("The issue title");
    expect(draft).toContain(
      "Markdown: what happened, how to reproduce, cause, fix, tests"
    );
  });
});

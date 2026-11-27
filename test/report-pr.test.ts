import { beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { eventsSince } from "../src/bronze/events";
import type { Identifiers } from "../src/report/leaks";
import type { ReportMeta } from "../src/report/meta";
import { type Git, openPullRequest } from "../src/report/pull-request";
import {
  draftReport,
  type Gh,
  REPORT_LABEL,
  readReport,
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
const OWNER = UPSTREAM_REPO.split("/")[0];

beforeEach(() => {
  process.env.PAL_HOME = resolve(freshTestDir(import.meta.file), "home");
});

const draft = (prose = "## What happened\nThe hook crashed.") =>
  draftReport("Hook crashes", prose, META, "/home/ada");

interface Fakes {
  commits?: string;
  diff?: string;
  fetches?: boolean;
  shared?: boolean;
  pushes?: boolean;
  login?: string;
  forks?: boolean;
  authed?: boolean;
  creates?: boolean;
}

function fakes(f: Fakes = {}) {
  const gitCalls: string[][] = [];
  const ghCalls: string[][] = [];
  const git: Git = (args) => {
    gitCalls.push(args);
    const answers: Record<string, { ok: boolean; out: string }> = {
      fetch: { ok: f.fetches ?? true, out: "" },
      "merge-base": { ok: f.shared ?? true, out: "abc" },
      log: { ok: true, out: f.commits ?? "fix(hooks): stop the crash" },
      diff: { ok: true, out: f.diff ?? "+const ok = true;" },
      push: { ok: f.pushes ?? true, out: "" },
    };

    return answers[args[0]] ?? { ok: false, out: "" };
  };
  const gh: Gh = (args) => {
    ghCalls.push(args);

    if (args[0] === "auth") return { ok: f.authed ?? true, out: "" };

    if (args[0] === "api") return { ok: true, out: f.login ?? "ada" };

    if (args[0] === "repo") return { ok: f.forks ?? true, out: "" };

    return {
      ok: f.creates ?? true,
      out: f.creates === false ? "label not found" : "https://github.com/x/y/pull/7",
    };
  };

  return { git, gh, gitCalls, ghCalls };
}

const open = (report = draft(), f: Fakes = {}) => {
  const fake = fakes(f);

  return {
    ...fake,
    outcome: openPullRequest(report, { git: fake.git, gh: fake.gh, ids: IDS }),
  };
};

describe("openPullRequest", () => {
  test("pushes the fix to the user's fork and opens a labelled PR against canary", () => {
    const report = draft();
    const { outcome, gitCalls, ghCalls } = open(report);

    expect(outcome).toEqual({ kind: "opened", url: "https://github.com/x/y/pull/7" });
    expect(ghCalls.find((c) => c[0] === "repo")).toEqual([
      "repo",
      "fork",
      UPSTREAM_REPO,
      "--clone=false",
    ]);
    expect(gitCalls.find((c) => c[0] === "push")).toEqual([
      "push",
      "--quiet",
      `https://github.com/ada/${UPSTREAM_REPO.split("/")[1]}.git`,
      `HEAD:refs/heads/report/${report.id}`,
    ]);
    expect(ghCalls.at(-1)).toEqual(
      expect.arrayContaining([
        "pr",
        "create",
        "-R",
        UPSTREAM_REPO,
        "--base",
        "canary",
        "--head",
        `ada:report/${report.id}`,
        "--title",
        "Hook crashes",
        "--label",
        REPORT_LABEL,
      ])
    );
    expect(readReport(report.id).sent).toBeDefined();
    expect(eventsSince("upstream_report", new Date(0)).at(-1)).toMatchObject({
      action: "sent",
      via: "pr",
    });
  });

  test("the repository's owner pushes to it directly, without a fork", () => {
    const { outcome, ghCalls, gitCalls } = open(draft(), { login: OWNER });

    expect(outcome.kind).toBe("opened");
    expect(ghCalls.some((c) => c[0] === "repo")).toBe(false);
    expect(gitCalls.find((c) => c[0] === "push")?.[2]).toBe(
      `https://github.com/${UPSTREAM_REPO}.git`
    );
  });

  test("diffs against upstream canary fetched by URL", () => {
    const { gitCalls } = open();

    expect(gitCalls.slice(0, 4)).toEqual([
      ["fetch", "--quiet", `https://github.com/${UPSTREAM_REPO}.git`, "canary"],
      ["merge-base", "FETCH_HEAD", "HEAD"],
      ["log", "--format=%B", "FETCH_HEAD..HEAD"],
      ["diff", "FETCH_HEAD...HEAD"],
    ]);
  });

  for (const [source, report, f] of [
    ["report", () => draft("It broke in acme-billing."), {}],
    ["commits", () => draft(), { commits: "fix: acme-billing crash" }],
    ["diff", () => draft(), { diff: "+// path /home/ada/acme-billing" }],
  ] as const)
    test(`a leak in the ${source} blocks it before anything is pushed`, () => {
      const { outcome, gitCalls, ghCalls } = open(report(), f);

      expect(outcome).toMatchObject({ kind: "blocked", source });
      expect(gitCalls.some((c) => c[0] === "push")).toBe(false);
      expect(ghCalls.some((c) => c[0] === "pr")).toBe(false);
      expect(eventsSince("upstream_report", new Date(0)).at(-1)).toMatchObject({
        action: "blocked",
      });
    });

  for (const [why, f, reason] of [
    ["gh is not signed in", { authed: false }, "A pull request needs gh signed in."],
    ["the folder cannot fetch PAL", { fetches: false }, "is not a git checkout"],
    ["the folder shares no history with PAL", { shared: false }, "shares no history"],
    ["there is no commit ahead of canary", { commits: "" }, "No commits ahead of canary"],
    ["no fork can be made", { forks: false }, "Could not find or create your fork"],
    ["the push fails", { pushes: false }, "Could not push report/"],
    ["gh cannot open the PR", { creates: false }, "label not found"],
  ] as const)
    test(`refuses when ${why}`, () => {
      const report = draft();
      const { outcome } = open(report, f);

      expect(outcome.kind).toBe("refused");
      expect(outcome.kind === "refused" && outcome.reason).toContain(reason);
      expect(readReport(report.id).sent).toBeUndefined();
    });
});

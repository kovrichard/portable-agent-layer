import { beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { writeFakeBin } from "../fixtures/fake-bin";
import { freshTestDir } from "./test-home";

export const PLUGIN_ROOT = resolve(import.meta.dir, "../../assets/plugins/dark-factory");
export const NOW = new Date("2026-10-20T12:00:00Z");
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

export const paths = {
  root: "",
  home: "",
  bin: "",
  repo: "",
  claudeLog: "",
  claudeReply: "",
  claudeResumeReply: "",
  mergedAt: "",
};

const processEnvWithoutPath = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path")
  );

export const env = () =>
  ({
    ...processEnvWithoutPath(),
    ...GIT_ENV,
    DARK_FACTORY_HOME: paths.home,
    FAKE_CLAUDE_LOG: paths.claudeLog,
    FAKE_CLAUDE_REPLY: paths.claudeReply,
    FAKE_CLAUDE_RESUME_REPLY: paths.claudeResumeReply,
    FAKE_MERGED_AT: paths.mergedAt,
    PATH: [paths.bin, process.env.PATH ?? ""].join(delimiter),
  }) as Record<string, string>;

function fakeBins() {
  mkdirSync(paths.bin, { recursive: true });
  writeFakeBin(
    paths.bin,
    "claude",
    [
      `const fs = require("node:fs");`,
      `const stdin = await Bun.stdin.text();`,
      `fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv: process.argv.slice(2), stdin }) + "\\n");`,
      `const resuming = process.argv.includes("--resume") && process.env.FAKE_CLAUDE_RESUME_REPLY;`,
      `const replyFile = resuming ? process.env.FAKE_CLAUDE_RESUME_REPLY : process.env.FAKE_CLAUDE_REPLY;`,
      `const structured = JSON.parse(fs.readFileSync(replyFile, "utf8"));`,
      `process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", session_id: "sess-coach", total_cost_usd: 0.1, num_turns: 1, duration_ms: 1, usage: {}, structured_output: structured }));`,
      "",
    ].join("\n")
  );
  writeFakeBin(
    paths.bin,
    "gh",
    [
      `const args = process.argv.slice(2);`,
      `if (args[0] === "pr" && args[1] === "view") process.stdout.write(JSON.stringify({ mergedAt: process.env.FAKE_MERGED_AT }));`,
      `if (args[0] === "pr" && args[1] === "diff") process.stdout.write("");`,
      "",
    ].join("\n")
  );
}

export function replyWith(result: object) {
  writeFileSync(paths.claudeReply, JSON.stringify(result));
}

export function resumeWith(result: object) {
  writeFileSync(paths.claudeResumeReply, JSON.stringify(result));
}

export const finding = (over: object = {}) => ({
  id: "c1",
  status: "pending",
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  class: "open repro",
  role: "debugger",
  rule: "Close the loop on every repro.",
  severity: "medium",
  metric: "fixRounds",
  elsewhere: "task-x",
  evidence: [{ task: "t1", ref: "event gate" }],
  ...over,
});

export const coachResult = (over: object = {}) => ({
  class: "spec reports",
  role: "po",
  rule: "State what to report, not where.",
  evidence: [{ task: "t1", ref: "event review" }],
  severity: "high",
  metric: "reviewFindings",
  elsewhere: "task-y",
  ...over,
});

export function startEachTestInAFreshFactory(testFile: string) {
  beforeEach(() => {
    paths.root = freshTestDir(testFile);
    paths.home = join(paths.root, "factory");
    paths.bin = join(paths.root, "bin");
    paths.repo = join(paths.root, "repo");
    paths.claudeLog = join(paths.root, "claude.jsonl");
    paths.claudeReply = join(paths.root, "reply.json");
    paths.claudeResumeReply = join(paths.root, "resume.json");
    paths.mergedAt = "2999-01-01T00:00:00Z";
    mkdirSync(paths.home, { recursive: true });
    fakeBins();
    replyWith({ findings: [], updates: [] });
    resumeWith({ findings: [], updates: [], reviewed: [] });
  });
}

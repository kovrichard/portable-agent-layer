import { beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { type StoreName, storeDir, storeNamed } from "../src/bronze/bronze";
import { appendEvent } from "../src/bronze/events";
import { appendImportLog } from "../src/bronze/import-log";
import { recordAction } from "../src/bronze/ledger";
import { emitRating } from "../src/bronze/signals";
import { appendToolOutput } from "../src/bronze/tool-output";
import { preserveTranscriptsOnce } from "../src/bronze/transcript-preserve";
import { palHome } from "../src/core/paths";
import { reload } from "../src/core/settings";
import { queueForReview } from "../src/knowledge/entity-extraction";
import { recordCandidate } from "../src/opinions/adaptation-candidates";
import { addDraft, decideRule } from "../src/opinions/adaptation-rules";
import { watchReplyRules } from "../src/opinions/adaptation-steering";
import { appendTurn } from "../src/opinions/adaptation-turns";
import { watchClaims } from "../src/opinions/claim-log";
import { writeBinding } from "../src/progress/bindings";
import { appendEvent as appendProgressEvent } from "../src/progress/progress-tree";
import { addSchedule, newSchedule } from "../src/progress/scheduled-prompts";
import { appendProjectHistory, writeSession } from "../src/progress/work-tracking";
import { recordRunEstimate } from "../src/safety/run-estimates";
import { run as algorithmReflect } from "../src/tools/agent/algorithm-reflect";
import { taskIsaCommands } from "../src/tools/agent/project-task-isa";
import { freshTestDir } from "./lib/test-home";

let HOME: string;

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  reload();
});

const LOCATION_TODAY: Record<StoreName, string> = {
  transcripts: "records/raw/claude",
  events: "memory/events",
  "event-text": "memory/content/events",
  "tool-output": "memory/content/tool-output",
  ledger: "records/ledger",
  ratings: "records/ratings",
  "claim-checks": "records/claim-checks",
  "labelled-turns": "records/labelled-turns",
  "rule-events": "records/rule-events",
  "rule-candidates": "records/rule-candidates",
  "run-estimates": "records/run-estimates",
  reflections: "records/reflections",
  "progress-tree": "work/progress-tree",
  "sessions-archive": "records/sessions-archive",
  "project-history": "work/projects",
  "unbound-history": "work/unbound-history",
  "task-isas": "work/tasks",
  schedules: "work/schedules",
  "review-queue": "records/review-queue",
  "import-log": "records/import-log",
};

function checkout(name: string): string {
  const dir = resolve(HOME, "checkouts", name);
  mkdirSync(dir, { recursive: true });

  return dir;
}

function registerProject(name: string): string {
  const record = resolve(storeDir("project-history"), name);
  mkdirSync(record, { recursive: true });
  writeFileSync(
    resolve(record, "ISA.md"),
    `---\nname: "${name}"\nstatus: "active"\ncreated: "2026-01-01"\n---\n\n## Goal\nShip.\n`
  );
  const dir = checkout(name);
  writeBinding(name, dir);

  return dir;
}

async function preserveOneTranscript(): Promise<void> {
  const claudeDir = resolve(HOME, "claude-config");
  const project = resolve(claudeDir, "projects", "-work-app");
  mkdirSync(project, { recursive: true });
  writeFileSync(resolve(project, "s1.jsonl"), `${JSON.stringify({ type: "user" })}\n`);
  const previous = process.env.PAL_CLAUDE_DIR;
  process.env.PAL_CLAUDE_DIR = claudeDir;

  try {
    await preserveTranscriptsOnce();
  } finally {
    process.env.PAL_CLAUDE_DIR = previous;
  }
}

function stopWithAClaim(): void {
  const transcript = resolve(HOME, "transcript.jsonl");
  writeFileSync(
    transcript,
    `${JSON.stringify({ type: "user", message: { content: "run the tests" } })}\n`
  );
  watchClaims({
    session_id: "s1",
    last_assistant_message: "Renamed the worker. All tests pass.",
    transcript_path: transcript,
  });
}

function fireAReplyRule(): void {
  const rule = addDraft({
    when: "Claiming tests pass",
    trigger: { side: "reply", pattern: "tests? pass" },
    steering: "Show the test output.",
    evidence: [],
  });
  decideRule(rule.id, "approved");
  watchReplyRules({ session_id: "s1", last_assistant_message: "All tests pass." });
}

function archiveOneSession(): void {
  for (let n = 0; n <= 50; n++) {
    writeSession({
      sessionId: `s${n}`,
      name: `session ${n}`,
      ts: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(),
      cwd: HOME,
      status: "completed",
      summary: "",
      artifacts: [],
      handoff: "",
      messageCount: 1,
    });
  }
}

const historyEntry = { date: "2026-11-15", title: "t", summary: "s", insights: "i" };

const WRITE_ONE: Record<StoreName, () => unknown> = {
  transcripts: preserveOneTranscript,
  events: () => appendEvent("turn", { words: 1 }, { cwd: HOME }),
  "event-text": () =>
    appendEvent("turn", { words: 1 }, { cwd: HOME, content: { prompt: "hello" } }),
  "tool-output": () =>
    appendToolOutput({
      id: "e1",
      ts: "2026-11-15T10:00:00.000Z",
      tool: "Read",
      output: "four",
    }),
  ledger: () =>
    recordAction({
      tool: "Edit",
      target: "/work/app/src/index.ts",
      outcome: "applied",
      before: "const a = 1;",
      after: "const a = 2;",
    }),
  ratings: () => emitRating(7, "fine"),
  "claim-checks": stopWithAClaim,
  "labelled-turns": () =>
    appendTurn({
      session: "s1",
      message: "no, the other one",
      replyEnd: "Renamed the key.",
      reaction: "corrected",
      issue: "wrong key",
    }),
  "rule-events": fireAReplyRule,
  "rule-candidates": () =>
    recordCandidate(
      {
        when: "Reporting that tests pass",
        trigger: { side: "reply", pattern: "tests? pass" },
        steering: "Quote the test run.",
        check: "The reply quotes a test run.",
        evidence: [],
      },
      []
    ),
  "run-estimates": () =>
    recordRunEstimate(
      {
        kind: "timebox",
        scope: "pal",
        startedAt: "2026-11-15T10:00:00.000Z",
        until: "2026-11-15T11:00:00.000Z",
        task: null,
        report: null,
        tasks: [],
        fallbacks: [],
        rules: [],
        log: [],
        done: true,
        stopBlocks: 0,
      },
      new Date("2026-11-15T10:30:00.000Z")
    ),
  reflections: () =>
    algorithmReflect(["--task", "t", "--q1", "a", "--q2", "b", "--q3", "c"]),
  "progress-tree": () =>
    appendProgressEvent("pal", "a", "open", { title: "registry check", parent: null }),
  "sessions-archive": archiveOneSession,
  "project-history": () => appendProjectHistory(registerProject("alpha"), historyEntry),
  "unbound-history": () => appendProjectHistory(checkout("loose"), historyEntry),
  "task-isas": () =>
    taskIsaCommands["scaffold-task-isa"].run({
      values: {},
      positionals: ["Fix", "it"],
      passedThrough: [],
      argv: [],
    }),
  schedules: () =>
    addSchedule(newSchedule({ scope: "user", from: "09:00", text: "Stand up." })),
  "review-queue": () =>
    queueForReview([
      {
        ts: "2026-11-15T10:00:00.000Z",
        source: "test",
        id: "r1",
        reason: "unknown-existing",
        entity: {
          kind: "person",
          name: "Ada",
          existing: "",
          aliases: [],
          role: "",
          organization: "",
          relation: "",
          fact: "",
        },
        candidates: [],
      },
    ]),
  "import-log": () =>
    appendImportLog(palHome(), {
      ts: "2026-11-15T10:00:00.000Z",
      archive: "a.tar.gz",
      mode: "merge",
      created: 0,
      merged: 0,
      identical: 0,
      conflicts: 0,
      skipped: 0,
      linesAdded: 0,
      quarantineDir: null,
    }),
};

const PLACEHOLDERS: Record<string, string> = {
  "<YYYY-MM>": String.raw`\d{4}-\d{2}`,
  "<YYYY-MM or undated>": String.raw`(?:\d{4}-\d{2}|undated)`,
  "<stamp>": "[^/]+",
  "<project>": "[^/]+",
  "<slug>": "[^/]+",
  "<file>": "[^/]+",
  "**/": "(?:.+/)?",
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function patternOf(name: string): string {
  return name
    .split(/(<[^>]+>|\*\*\/)/)
    .map((part) => PLACEHOLDERS[part] ?? escapeRegExp(part))
    .join("");
}

function namesFitting(files: string): RegExp {
  const alternatives = files.split(", rotated to ").map(patternOf);

  return new RegExp(`^(?:${alternatives.join("|")})$`);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .filter((entry) => statSync(resolve(dir, entry)).isFile())
    .map((entry) => entry.replaceAll("\\", "/"));
}

describe("each recorded store's writer files into the registry's folder", () => {
  for (const name of Object.keys(WRITE_ONE) as StoreName[]) {
    test(name, async () => {
      await WRITE_ONE[name]();
      const store = storeNamed(name);
      const dir = storeDir(name);

      expect(relative(HOME, dir).replaceAll("\\", "/")).toBe(LOCATION_TODAY[name]);
      expect(
        filesUnder(dir).filter((file) => namesFitting(store.files).test(file))
      ).not.toEqual([]);
    });
  }
});

describe("parked history moves between the registry's history folders", () => {
  test("binding a project adopts history parked in unbound-history into project-history", () => {
    const parked = resolve(storeDir("unbound-history"), "alpha.jsonl");
    writeFileSync(parked, `${JSON.stringify(historyEntry)}\n`);

    registerProject("alpha");

    expect(existsSync(parked)).toBe(false);
    expect(
      readFileSync(
        resolve(storeDir("project-history"), "alpha", "history.jsonl"),
        "utf-8"
      )
    ).toContain(historyEntry.title);
  });
});

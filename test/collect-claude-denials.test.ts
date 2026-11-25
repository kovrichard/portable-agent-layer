import { beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/core/settings";
import { collectClaudeDenials } from "../src/tools/lib/collectors/claude-denials";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

// Line shapes from Claude Code 2.1.332 transcripts: the call on an assistant
// line, its refusal on the user line after it, labelled by toolDenialKind and
// permissionDecision.

let home: string;
let projects: string;
let transcript: string;

const NOW = new Date("2026-11-25T13:00:00.000Z");
const DONT_ASK = {
  decision: "reject",
  source: "config",
  reasonType: "mode",
  reasonCode: "mode:dontAsk",
};

function dontAskText(tool: string): string {
  return `Permission to use ${tool} has been denied because Claude Code is running in don't ask mode. IMPORTANT: You *may* attempt to accomplish this action using other tools.`;
}

function call(id: string, name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-11-25T12:21:05.000Z",
    sessionId: "job-session",
    cwd: home,
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
}

function result(id: string, text: string, label: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "user",
    timestamp: "2026-11-25T12:21:06.128Z",
    sessionId: "job-session",
    cwd: home,
    message: {
      content: [{ type: "tool_result", content: text, is_error: true, tool_use_id: id }],
    },
    ...label,
  });
}

function ok(id: string): string {
  return JSON.stringify({
    type: "user",
    sessionId: "job-session",
    message: { content: [{ type: "tool_result", content: "done", tool_use_id: id }] },
  });
}

function dontAsk(id: string, name: string, input: Record<string, unknown>): string[] {
  return [
    call(id, name, input),
    result(id, dontAskText(name), {
      toolDenialKind: "permission-rule",
      permissionDecision: DONT_ASK,
    }),
  ];
}

const EVENING_LEADS = [
  ...dontAsk("toolu_1", "Bash", {
    command: "mkdir -p out && cd out && python3 -I discover.py",
  }),
  ...dontAsk("toolu_2", "Bash", { command: 'pal cli progress open "Evening run"' }),
  call("toolu_ok", "Read", { file_path: "/x/notes.md" }),
  ok("toolu_ok"),
  ...dontAsk("toolu_3", "Bash", {
    command: "curl -sL -o /dev/null https://example.com/sitemap.xml",
  }),
  ...dontAsk("toolu_4", "Monitor", {
    command: "until test -s out.txt; do :; done",
    timeout_ms: 600000,
  }),
  ...dontAsk("toolu_5", "Bash", {
    command: "for s in a b c; do gh api repos/o/r/commits/$s; done",
  }),
  ...dontAsk("toolu_6", "Bash", { command: "npm search --json nevis | head -c 1500" }),
  JSON.stringify({
    type: "api-request-blob",
    sessionId: "job-session",
    hash: "h",
    message: {
      content: [
        {
          type: "tool_result",
          content: dontAskText("Bash"),
          is_error: true,
          tool_use_id: "toolu_1",
        },
      ],
    },
  }),
];

function write(...lines: string[]) {
  appendFileSync(transcript, `${lines.join("\n")}\n`);
}

function streamed(dir = "events"): Record<string, unknown>[] {
  const path = resolve(home, "memory", ...dir.split("/"));
  if (!existsSync(path)) return [];

  return readdirSync(path)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(resolve(path, f), "utf-8").trim().split("\n"))
    .map((l) => JSON.parse(l));
}

const denials = () => streamed().filter((e) => e.type === "tool_call");

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  projects = resolve(home, "claude", "projects");
  mkdirSync(resolve(projects, "-sales"), { recursive: true });
  transcript = resolve(projects, "-sales", "job-session.jsonl");
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("collecting Claude Code's permission denials", () => {
  test("the evening-leads job's six don't-ask denials are all found, and nothing else", async () => {
    write(...EVENING_LEADS);
    expect(await collectClaudeDenials(projects, NOW)).toBe(6);
    expect(denials().map((e) => [e.tool, e.toolUseId])).toEqual([
      ["Bash", "toolu_1"],
      ["Bash", "toolu_2"],
      ["Bash", "toolu_3"],
      ["Monitor", "toolu_4"],
      ["Bash", "toolu_5"],
      ["Bash", "toolu_6"],
    ]);
  });

  test("each denial is a denied tool_call linked to its session, labelled by its code", async () => {
    write(...EVENING_LEADS);
    await collectClaudeDenials(projects, NOW);
    expect(denials()[0]).toMatchObject({
      ts: "2026-11-25T12:21:06.128Z",
      session: "job-session",
      runtime: "claude",
      outcome: "denied",
      denial: "mode:dontAsk",
      program: "mkdir",
    });
  });

  test("the full input and the reason go to the content store", async () => {
    write(...EVENING_LEADS);
    await collectClaudeDenials(projects, NOW);
    const [first] = streamed("content/events");
    expect(first).toMatchObject({
      tool: "Bash",
      input: { command: "mkdir -p out && cd out && python3 -I discover.py" },
      reason: dontAskText("Bash"),
      kind: "permission-rule",
      decision: DONT_ASK,
    });
    expect(first.id).toBe(denials()[0].id);
  });

  test("a deny rule, a safety check and a dialog refusal are denials too", async () => {
    write(
      call("r", "Bash", { command: "sed -i s/a/b/ f" }),
      result(
        "r",
        "Permission to use Bash with command sed -i s/a/b/ f has been denied.",
        {
          toolDenialKind: "permission-rule",
          permissionDecision: { source: "config", reasonCode: "rule:projectSettings" },
        }
      ),
      call("s", "Bash", { command: "rm -rf ~" }),
      result(
        "s",
        "Permission for this command was denied by a built-in Claude Code safety check",
        {
          toolDenialKind: "permission-rule",
          permissionDecision: { source: "config", reasonCode: "safetyCheck" },
        }
      ),
      call("d", "Edit", { file_path: "/x/a.ts" }),
      result("d", "The user doesn't want to proceed with this tool use.", {
        toolDenialKind: "user-rejected",
        permissionDecision: null,
      })
    );
    await collectClaudeDenials(projects, NOW);
    expect(denials().map((e) => e.denial)).toEqual([
      "rule:projectSettings",
      "safetyCheck",
      "user-rejected",
    ]);
  });

  test("auto mode's denials, hook blocks and interruptions are left to the hooks", async () => {
    write(
      call("a", "Bash", { command: "x" }),
      result(
        "a",
        "Permission for this action was denied by the Claude Code auto mode classifier.",
        {
          toolDenialKind: "automode-blocked",
        }
      ),
      call("u", "Bash", { command: "x" }),
      result("u", "The server-side auto mode classifier gave no verdict for Bash", {
        toolDenialKind: "automode-unavailable",
      }),
      call("h", "Bash", { command: "x" }),
      result("h", "PreToolUse:Bash hook error: Blocked: pipe to shell", {
        toolDenialKind: "permission-rule",
        permissionDecision: { source: "hook", reasonCode: "hook:PreToolUse" },
      }),
      call("i", "Bash", { command: "x" }),
      result("i", "[Tool call interrupted: the session ended]", {
        toolDenialKind: "interrupted",
      })
    );
    expect(await collectClaudeDenials(projects, NOW)).toBe(0);
  });

  test("a second run logs nothing new", async () => {
    write(...EVENING_LEADS);
    await collectClaudeDenials(projects, NOW);
    expect(await collectClaudeDenials(projects, NOW)).toBe(0);
    expect(denials()).toHaveLength(6);
  });

  test("a call still waiting at its dialog is read again once it is refused", async () => {
    write(call("w", "Bash", { command: "git push" }));
    expect(await collectClaudeDenials(projects, NOW)).toBe(0);
    write(
      result("w", "The user doesn't want to proceed with this tool use.", {
        toolDenialKind: "user-rejected",
      })
    );
    expect(await collectClaudeDenials(projects, NOW)).toBe(1);
    expect(await collectClaudeDenials(projects, NOW)).toBe(0);
    expect(denials()[0]).toMatchObject({ tool: "Bash", program: "git" });
  });

  test("a transcript Claude Code deleted is read from PAL's copy", async () => {
    write(...EVENING_LEADS);
    const copies = resolve(home, "memory", "content", "claude");
    mkdirSync(resolve(copies, "-sales"), { recursive: true });
    writeFileSync(
      resolve(copies, "-sales", "job-session.jsonl.gz"),
      Bun.gzipSync(readFileSync(transcript))
    );
    removeOnceReleased(transcript);
    expect(await collectClaudeDenials(projects, NOW, copies)).toBe(6);
  });
});

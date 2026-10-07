import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  blockResponse,
  declaredAgent,
  normalizeToolUse,
  stopBlockResponse,
} from "../src/hooks/lib/agent";
import { isSideStop, latestUserRequest } from "../src/hooks/lib/antigravity-transcript";
import { alreadySentBack } from "../src/hooks/lib/claim-log";
import { enterHookWorkspace } from "../src/hooks/lib/hook-turn";
import { invocationContext } from "../src/hooks/lib/invocation-context";
import { landedCalls, ledgeredCalls } from "../src/hooks/lib/ledger-hook";
import { agentDirOverrides, paths } from "../src/hooks/lib/paths";
import { decideRefusal } from "../src/hooks/lib/security-gate";

// Every payload and transcript step below was captured from agy 1.3.1 by a hook
// that wrote its stdin to disk; only the paths are swapped for sandbox ones.

const HOOKS = resolve(import.meta.dir, "../src/hooks");

// Assembled at runtime so this file does not contain the literal pattern that
// PAL's own SecurityValidator blocks when an agent edits or greps it.
const DANGEROUS = `${"rm -r"}${"f /"}`;

const CONVERSATION = "40a52bef-33e9-4979-a9e4-cb99c5303691";

let sandbox: string;
let workspace: string;
let transcript: string;
const savedEnv: Record<string, string | undefined> = {};
const SANDBOXED_ENV = ["PAL_HOME", "PAL_AGENT", ...agentDirOverrides().map((o) => o.env)];

function agyPayload(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    artifactDirectoryPath: `/agy/brain/${CONVERSATION}`,
    conversationId: CONVERSATION,
    modelName: "gemini-3.8-flash-medium",
    transcriptPath: transcript,
    workspacePaths: [workspace],
    ...fields,
  };
}

function runCommand(commandLine: string) {
  return agyPayload({
    stepIdx: 7,
    toolCall: {
      args: {
        CommandLine: commandLine,
        Cwd: workspace,
        WaitMsBeforeAsync: 5000,
        toolAction: "Listing directory contents",
        toolSummary: "List directory",
      },
      name: "run_command",
    },
  });
}

function writeToFile(target: string) {
  return agyPayload({
    stepIdx: 3,
    toolCall: {
      args: {
        CodeContent: "hello",
        Description: "Create probe.txt containing hello",
        Overwrite: true,
        TargetFile: target,
        toolAction: "Creating probe.txt",
        toolSummary: "Create probe file",
      },
      name: "write_to_file",
    },
  });
}

const preInvocation = (invocationNum: number) =>
  agyPayload({ initialNumSteps: 1 + 2 * invocationNum, invocationNum });

const stop = (fields: Record<string, unknown> = {}) =>
  agyPayload({
    error: "",
    executionNum: 0,
    fullyIdle: true,
    terminationReason: "NO_TOOL_CALL",
    ...fields,
  });

function userInput(request: string, source = "USER_EXPLICIT") {
  return {
    step_index: 0,
    source,
    type: "USER_INPUT",
    status: "DONE",
    created_at: "2026-10-07T14:17:46Z",
    content: `<USER_REQUEST>\n${request}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-10-07T16:17:46+02:00.\n</ADDITIONAL_METADATA>`,
  };
}

const SUBAGENT_OPENING = {
  step_index: 0,
  source: "SYSTEM",
  type: "SYSTEM_MESSAGE",
  status: "DONE",
  created_at: "2026-10-07T14:35:36Z",
  content:
    "The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n\n<SYSTEM_MESSAGE>\n[Message] timestamp=2026-10-07T14:35:36Z sender=298eb946-5a54-496e-afdc-db3a6c882bd9 priority=MESSAGE_PRIORITY_HIGH content=Reply with your exact model ID.\n</SYSTEM_MESSAGE>",
};

function writeTranscript(...steps: unknown[]): void {
  writeFileSync(transcript, steps.map((s) => JSON.stringify(s)).join("\n"), "utf-8");
}

function localDay(): { month: string; day: string } {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return { month, day: `${month}-${String(now.getDate()).padStart(2, "0")}` };
}

/** Something for the session reminder to carry, so its presence can be seen. */
function seedRelationshipNote(marker: string): void {
  const { month, day } = localDay();
  const dir = resolve(paths.relationship(), month);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, `${day}.md`),
    `# Relationship Notes — ${day}\n\n## 10:00\n- W: ${marker}\n`,
    "utf-8"
  );
}

beforeEach(() => {
  sandbox = realpathSync(mkdtempSync(resolve(tmpdir(), "pal-agy-hooks-")));
  workspace = resolve(sandbox, "workspace");
  mkdirSync(workspace, { recursive: true });
  transcript = resolve(sandbox, "transcript_full.jsonl");
  for (const key of SANDBOXED_ENV) savedEnv[key] = process.env[key];
  process.env.PAL_HOME = resolve(sandbox, "home");
  for (const { env } of agentDirOverrides()) process.env[env] = resolve(sandbox, env);
  delete process.env.PAL_AGENT;
});

afterEach(() => {
  for (const key of SANDBOXED_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(sandbox, { recursive: true, force: true });
});

describe("agy nests the tool call as toolCall: { name, args }", () => {
  test("its name and arguments are read from there", () => {
    expect(normalizeToolUse(runCommand("ls -la"))).toEqual({
      toolName: "run_command",
      toolInput: expect.objectContaining({ CommandLine: "ls -la" }),
    });
  });

  test("a toolCall with no name is no tool call", () => {
    expect(normalizeToolUse(agyPayload({ toolCall: { args: {} } }))).toBeNull();
  });
});

describe("the security gate reads agy's tools", () => {
  test("a dangerous run_command is refused", () => {
    expect(decideRefusal(runCommand(DANGEROUS), workspace)?.command).toBe(DANGEROUS);
  });

  test("a harmless one is let through", () => {
    expect(decideRefusal(runCommand("ls -la"), workspace)).toBeNull();
  });

  test("a write_to_file into PAL's own memory is refused by its TargetFile", () => {
    const target = resolve(paths.memory(), "projects", "demo", "ISA.md");
    expect(decideRefusal(writeToFile(target), workspace)?.target).toBe(target);
  });
});

describe("agy's replies", () => {
  beforeEach(() => {
    process.env.PAL_AGENT = "antigravity";
  });

  test("a tool is denied with decision deny and the reason", () => {
    expect(JSON.parse(blockResponse("no", "PreToolUse"))).toEqual({
      decision: "deny",
      reason: "no",
    });
  });

  test("a stop is refused with decision continue, which agy turns into a next step", () => {
    expect(JSON.parse(stopBlockResponse("again"))).toEqual({
      decision: "continue",
      reason: "again",
    });
  });

  test("a stop agy already continued once is not sent back again", () => {
    expect(alreadySentBack(stop({ executionNum: 1 }))).toBe(true);
    expect(alreadySentBack(stop())).toBe(false);
  });
});

describe("SecurityValidator under agy", () => {
  // Bun.spawn hands a child the environment the process started with, which lacks
  // both this sandbox and the preload's PAL_TEST_SANDBOX, so it is passed by hand.
  async function runValidator(stdin: string) {
    const proc = Bun.spawn(
      ["bun", "run", resolve(HOOKS, "SecurityValidator.ts"), "--agent=antigravity"],
      {
        stdin: new TextEncoder().encode(stdin),
        stdout: "pipe",
        stderr: "ignore",
        env: process.env,
      }
    );
    const out = await new Response(proc.stdout).text();
    return { out: out.trim(), code: await proc.exited };
  }

  test("prints agy's deny for a dangerous command", async () => {
    const { out, code } = await runValidator(JSON.stringify(runCommand(DANGEROUS)));
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({ decision: "deny", reason: expect.any(String) });
  });

  test("records the refusal against agy's workspace, not the folder it ran from", async () => {
    await runValidator(JSON.stringify(runCommand(DANGEROUS)));
    const ledger = readFileSync(resolve(paths.ledger(), "actions.jsonl"), "utf-8");
    expect(JSON.parse(ledger.trim().split("\n")[0]).target).toBe(workspace);
  });

  // agy blocks the tool on any stdout or any non-zero exit, so silence is the only allow.
  test("prints nothing for a harmless one", async () => {
    expect(await runValidator(JSON.stringify(runCommand("ls -la")))).toEqual({
      out: "",
      code: 0,
    });
  });

  test("prints nothing for stdin it cannot read", async () => {
    expect(await runValidator("not json")).toEqual({ out: "", code: 0 });
  });
});

describe("the ledger pairs agy's two halves of a write", () => {
  test("write_to_file is recorded against its TargetFile", () => {
    const target = resolve(workspace, "probe.txt");
    expect(ledgeredCalls(writeToFile(target))).toEqual([
      { toolUseId: expect.any(String), tool: "write_to_file", target },
    ]);
  });

  test("both halves derive the same key, since agy publishes no call id", () => {
    const target = resolve(workspace, "probe.txt");
    const pre = ledgeredCalls(writeToFile(target));
    const post = landedCalls({ ...writeToFile(target), error: "" });
    expect(post).toEqual(pre);
  });

  test("a PostToolUse that reports an error landed nothing", () => {
    const failed = { ...writeToFile(resolve(workspace, "probe.txt")), error: "denied" };
    expect(landedCalls(failed)).toEqual([]);
  });

  test("a read is not recorded", () => {
    const view = agyPayload({
      toolCall: { args: { AbsolutePath: resolve(workspace, "a.ts") }, name: "view_file" },
    });
    expect(ledgeredCalls(view)).toEqual([]);
  });
});

describe("agy's transcript", () => {
  test("the latest request is what the user typed, without agy's envelope", () => {
    writeTranscript(userInput("first"), userInput("second"));
    expect(latestUserRequest(transcript)).toBe("second");
  });

  test("a step PAL injected is not mistaken for the user", () => {
    writeTranscript(userInput("mine"), userInput("injected", "SYSTEM_SDK"));
    expect(latestUserRequest(transcript)).toBe("mine");
  });

  test("a subagent's conversation has no request of its own", () => {
    writeTranscript(SUBAGENT_OPENING);
    expect(latestUserRequest(transcript)).toBeNull();
  });
});

describe("which agy stops end a turn of the user's", () => {
  test("a stop at the end of the user's turn is handled", () => {
    writeTranscript(userInput("hi"));
    expect(isSideStop(stop())).toBe(false);
  });

  test("a subagent finishing is not the user's turn ending", () => {
    writeTranscript(SUBAGENT_OPENING);
    expect(isSideStop(stop())).toBe(true);
  });

  test("a stop while agy is still busy is not either", () => {
    writeTranscript(userInput("hi"));
    expect(isSideStop(stop({ fullyIdle: false }))).toBe(true);
  });

  test("another agent's stop is never read as agy's", () => {
    writeTranscript(SUBAGENT_OPENING);
    expect(isSideStop({ fullyIdle: false, transcriptPath: transcript })).toBe(false);
  });

  // Until agy's transcript is parsed a handled stop changes nothing on disk either,
  // so the debug log is the one place the two can be told apart.
  test("StopOrchestrator never starts the stop handlers for a side stop", () => {
    writeTranscript(SUBAGENT_OPENING);
    writeFileSync(resolve(paths.state(), "debug-enabled"), "", "utf-8");
    const proc = Bun.spawnSync(
      ["bun", "run", resolve(HOOKS, "StopOrchestrator.ts"), "--agent=antigravity"],
      {
        stdin: new TextEncoder().encode(JSON.stringify(stop())),
        stderr: "ignore",
        env: process.env,
      }
    );
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toBe("");
    const debugLog = resolve(paths.debug(), "debug.log");
    expect(existsSync(debugLog) ? readFileSync(debugLog, "utf-8") : "").not.toContain(
      "stopTurn"
    );
  });
});

describe("PreInvocation injects context as one user step", () => {
  const injectedText = (reply: string | null) =>
    JSON.parse(reply ?? "{}").injectSteps?.[0]?.userMessage as string | undefined;

  beforeEach(() => {
    process.env.PAL_AGENT = "antigravity";
    writeTranscript(userInput("fix the build"));
    seedRelationshipNote("SEED-NOTE-4471");
  });

  test("the first turn carries the session context and the prompt context", async () => {
    const text = injectedText(await invocationContext(preInvocation(0)));
    expect(text).toContain("SEED-NOTE-4471");
    expect(text).toContain("Now:");
  });

  test("a later turn of the same conversation carries the prompt context alone", async () => {
    await invocationContext(preInvocation(0));
    writeTranscript(userInput("fix the build"), userInput("and the tests"));
    const text = injectedText(await invocationContext(preInvocation(0)));
    expect(text).not.toContain("SEED-NOTE-4471");
    expect(text).toContain("Now:");
  });

  // agy already loads these from the plugin's rules; injecting them again doubles them.
  test("the session context leaves out what agy loads natively", async () => {
    const selfModel = resolve(paths.memory(), "self-model", "current.md");
    mkdirSync(resolve(selfModel, ".."), { recursive: true });
    writeFileSync(selfModel, "SELF-MODEL-9902", "utf-8");
    const text = injectedText(await invocationContext(preInvocation(0)));
    expect(text).toContain("SEED-NOTE-4471");
    expect(text).not.toContain("SELF-MODEL-9902");
  });

  test("the prompt is captured like any other agent's, here as the session name", async () => {
    await invocationContext(preInvocation(0));
    const names = readFileSync(resolve(paths.state(), "session-names.json"), "utf-8");
    expect(JSON.parse(names)[CONVERSATION]).toBeString();
  });

  test("only the most recent conversations are remembered", async () => {
    const started = resolve(paths.state(), "antigravity-conversations.json");
    const older = Array.from({ length: 200 }, (_, i) => `older-${i}`);
    writeFileSync(started, JSON.stringify(older), "utf-8");
    await invocationContext(preInvocation(0));
    const kept = JSON.parse(readFileSync(started, "utf-8"));
    expect(kept).toHaveLength(200);
    expect(kept.at(-1)).toBe(CONVERSATION);
    expect(kept).not.toContain("older-0");
  });

  test("a later model call within a turn injects nothing", async () => {
    expect(await invocationContext(preInvocation(1))).toBeNull();
  });

  test("a subagent's conversation injects nothing", async () => {
    writeTranscript(SUBAGENT_OPENING);
    expect(await invocationContext(preInvocation(0))).toBeNull();
  });
});

describe("hooks run from the workspace agy names, not the plugin folder", () => {
  const original = process.cwd();
  afterEach(() => process.chdir(original));

  test("the first workspace path becomes the working directory", () => {
    enterHookWorkspace(stop());
    expect(process.cwd()).toBe(workspace);
  });

  test("a workspace that is not on disk leaves it alone", () => {
    enterHookWorkspace({ workspacePaths: [resolve(sandbox, "gone")] });
    expect(process.cwd()).toBe(original);
  });

  test("a payload naming no workspace leaves it alone", () => {
    enterHookWorkspace(null);
    enterHookWorkspace({ workspacePaths: [42] });
    enterHookWorkspace({ session_id: "s" });
    expect(process.cwd()).toBe(original);
  });
});

describe("agy is recognised from the environment it gives its hooks", () => {
  const RUNTIME_ENV = [
    "ANTIGRAVITY_CONVERSATION_ID",
    "CLAUDE_CODE_ENTRYPOINT",
    "CURSOR_AGENT",
    "CURSOR_VERSION",
    "CURSOR_INVOKED_AS",
    "CODEX_CLI_VERSION",
    "OPENAI_CODEX",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of RUNTIME_ENV) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.ANTIGRAVITY_CONVERSATION_ID = CONVERSATION;
  });

  afterEach(() => {
    for (const key of RUNTIME_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  test("its conversation id alone names it", () => {
    expect(declaredAgent()).toBe("antigravity");
  });

  test("an agent started inside agy inherits the id and is still itself", () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = "cli";
    expect(declaredAgent()).toBe("claude");
  });
});

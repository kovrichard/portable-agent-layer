import { beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  blockResponse,
  declaredAgent,
  normalizeToolUse,
  stopBlockResponse,
} from "../src/hooks/lib/agent";
import {
  isSideStop,
  latestUserRequest,
  withTranscriptReply,
} from "../src/hooks/lib/antigravity-transcript";
import { commandsThisTurn } from "../src/hooks/lib/claim-check";
import {
  alreadySentBack,
  claimChecksSince,
  watchClaims,
} from "../src/hooks/lib/claim-log";
import { eventsSince } from "../src/hooks/lib/events";
import { enterHookWorkspace } from "../src/hooks/lib/hook-turn";
import { invocationContext } from "../src/hooks/lib/invocation-context";
import { landedCalls, ledgeredCalls } from "../src/hooks/lib/ledger-hook";
import { paths } from "../src/hooks/lib/paths";
import { decideRefusal } from "../src/hooks/lib/security-gate";
import { reload } from "../src/hooks/lib/settings";
import { readTranscriptFile } from "../src/hooks/lib/transcript";
import {
  agyPayload,
  CONVERSATION,
  DANGEROUS,
  freshAgySandbox,
  ORIGINAL_CWD,
  plannerResponse,
  preInvocation,
  RUNTIME_ENV,
  runCommand,
  SUBAGENT_OPENING,
  said,
  startUserTurnUnderAgy,
  stop,
  userInput,
  writeTranscript,
} from "./lib/antigravity-hooks-fixture";

let sandbox: string;
let workspace: string;
let transcript: string;

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

const ranCommand = (commandLine: string) =>
  plannerResponse({
    tool_calls: [
      {
        name: "run_command",
        args: {
          CommandLine: commandLine,
          Cwd: "/ws",
          WaitMsBeforeAsync: 2000,
          toolAction: "Running command",
          toolSummary: "Run command",
        },
      },
    ],
  });

const TOOL_RESULT = {
  step_index: 3,
  source: "MODEL",
  type: "GENERIC",
  status: "ERROR",
  error: "tool call denied by pre-tool hook: Blocked: Disk partitioning",
  created_at: "2026-10-07T17:43:14Z",
  content: "Encountered error in step execution: tool call denied by pre-tool hook",
};

beforeEach(() => {
  ({ sandbox, workspace, transcript } = freshAgySandbox(import.meta.file));
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
});

describe("agy's transcript read as the turns of a conversation", () => {
  test("what the user typed and what the model said, and nothing around them", () => {
    writeTranscript(
      userInput("run the tests"),
      userInput("<system-reminder>context</system-reminder>", "SYSTEM_SDK"),
      ranCommand("bun test"),
      TOOL_RESULT,
      said("All tests pass.")
    );
    expect(readTranscriptFile(transcript)).toEqual([
      { role: "user", content: "run the tests" },
      { role: "assistant", content: "All tests pass." },
    ]);
  });
});

describe("agy's final reply comes from its transcript", () => {
  const replyOf = (payload: Record<string, unknown>) =>
    withTranscriptReply(payload)?.lastAssistantMessage;

  test("it is the model's last words since the user's latest request", () => {
    writeTranscript(
      userInput("first"),
      said("old"),
      userInput("second"),
      said("Looking."),
      ranCommand("ls"),
      said("new")
    );
    expect(replyOf(stop())).toBe("new");
  });

  test("an earlier turn's reply is not taken for this one's", () => {
    writeTranscript(
      userInput("first"),
      said("old"),
      userInput("second"),
      ranCommand("ls")
    );
    expect(replyOf(stop())).toBeUndefined();
  });

  test("a response with no words in it is no reply", () => {
    writeTranscript(userInput("first"), said("Done."), said("\n"), said(""));
    expect(replyOf(stop())).toBe("Done.");
  });

  test("no payload stays no payload", () => {
    expect(withTranscriptReply(null)).toBeNull();
  });

  test("a reply the payload already carries is kept", () => {
    writeTranscript(userInput("first"), said("from the transcript"));
    expect(replyOf(stop({ lastAssistantMessage: "given" }))).toBe("given");
  });

  test("another agent's payload is left as it came", () => {
    writeTranscript(userInput("first"), said("from the transcript"));
    const payload = { session_id: "s1", transcriptPath: transcript };
    expect(withTranscriptReply(payload)).toBe(payload);
  });
});

describe("the claim check reads agy's turn", () => {
  const lines = (...steps: unknown[]) => steps.map((s) => JSON.stringify(s));

  test("run_command counts as a command, from the user's latest request on", () => {
    const commands = commandsThisTurn(
      lines(
        userInput("a"),
        ranCommand("git status"),
        userInput("b"),
        ranCommand("bun test")
      )
    );
    expect(commands).toHaveLength(1);
    expect(commands?.[0]).toContain("bun test");
  });

  test("a step PAL injected does not start a new turn", () => {
    expect(
      commandsThisTurn(
        lines(userInput("a"), ranCommand("bun test"), userInput("ctx", "SYSTEM_SDK"))
      )
    ).toHaveLength(1);
  });

  test("a turn that ran nothing is readable, not unknown", () => {
    expect(commandsThisTurn(lines(userInput("a"), said("hi")))).toEqual([]);
  });

  test("a claim in agy's reply is backed by the command the turn ran", () => {
    reload();
    writeTranscript(
      userInput("run the tests"),
      ranCommand("bun test"),
      said("All tests pass.")
    );
    watchClaims(withTranscriptReply(stop()));
    expect(claimChecksSince(new Date(0))).toEqual([
      expect.objectContaining({ verdict: "backed", commands: 1 }),
    ]);
  });

  test("a tool that runs no command is not one", () => {
    const view = plannerResponse({
      tool_calls: [{ name: "view_file", args: { AbsolutePath: "/ws/a.ts" } }],
    });
    expect(commandsThisTurn(lines(userInput("a"), view))).toEqual([]);
  });
});

describe("PreInvocation injects context as one user step", () => {
  beforeEach(startUserTurnUnderAgy);

  test("a later model call within a turn injects nothing", async () => {
    expect(await invocationContext(preInvocation(1))).toBeNull();
  });

  test("nor is it timed, since no prompt was handled", async () => {
    await invocationContext(preInvocation(1));
    expect(eventsSince("hook_timing", new Date(0))).toEqual([]);
  });

  test("a subagent's conversation injects nothing", async () => {
    writeTranscript(SUBAGENT_OPENING);
    expect(await invocationContext(preInvocation(0))).toBeNull();
  });
});

describe("hooks run from the workspace agy names, not the plugin folder", () => {
  test("the first workspace path becomes the working directory", () => {
    enterHookWorkspace(stop());
    expect(process.cwd()).toBe(workspace);
  });

  test("a workspace that is not on disk leaves it alone", () => {
    enterHookWorkspace({ workspacePaths: [resolve(sandbox, "gone")] });
    expect(process.cwd()).toBe(ORIGINAL_CWD);
  });

  test("a payload naming no workspace leaves it alone", () => {
    enterHookWorkspace(null);
    enterHookWorkspace({ workspacePaths: [42] });
    enterHookWorkspace({ session_id: "s" });
    expect(process.cwd()).toBe(ORIGINAL_CWD);
  });
});

describe("agy is recognised from the environment it gives its hooks", () => {
  beforeEach(() => {
    for (const key of RUNTIME_ENV) delete process.env[key];
    process.env.ANTIGRAVITY_CONVERSATION_ID = CONVERSATION;
  });

  test("its conversation id alone names it", () => {
    expect(declaredAgent()).toBe("antigravity");
  });

  test("an agent started inside agy inherits the id and is still itself", () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = "cli";
    expect(declaredAgent()).toBe("claude");
  });
});

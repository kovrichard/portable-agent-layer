import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { progressSession } from "../src/hooks/lib/progress-session";
import { appendEvent } from "../src/hooks/lib/progress-tree";
import {
  decisionSendBack,
  progressTreeSendBack,
  stopProgressTree,
} from "../src/hooks/lib/progress-tree-gate";
import { reload } from "../src/hooks/lib/settings";
import type { StopTurnPayload } from "../src/hooks/lib/stop";
import { freshTestDir } from "./lib/test-home";

let home: string;
let folder: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  folder = resolve(home, "repo");
  mkdirSync(folder, { recursive: true });
  process.env.PAL_HOME = home;
  setting("progressTree", true);
});

const lines = (entries: unknown[]) => entries.map((e) => JSON.stringify(e));
const prompt = (text: string) => ({ type: "user", message: { content: text } });
const call = (name: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name, input }] },
});
const bash = (command: string) => call("Bash", { command });

const payload: StopTurnPayload = { session_id: "s" };
const check = (entries: unknown[], p: StopTurnPayload = payload) =>
  progressTreeSendBack(p, lines(entries), folder);

function setting(key: string, value: boolean | undefined) {
  mkdirSync(resolve(home, "memory"), { recursive: true });
  writeFileSync(
    resolve(home, "memory", "pal-settings.json"),
    JSON.stringify({
      dynamicContext: { progressTree: true, progressTreeGate: true, [key]: value },
    })
  );
  reload();
}

describe("the progress-tree gate", () => {
  test("sends back a turn that committed and recorded nothing", () => {
    const reason = check([prompt("ship it"), bash("git commit -m 'feat: x'")]);
    expect(reason).toContain(
      "This turn committed but recorded nothing in the progress tree"
    );
    expect(reason).toContain("pal cli progress stopped");
  });

  test("names the active node so the agent knows where to record", () => {
    appendEvent(
      folder,
      "n1",
      "open",
      { title: "Gate", parent: null },
      undefined,
      undefined,
      progressSession("s")
    );
    expect(check([prompt("ship it"), bash("git commit -m x")])).toContain(
      "Progress: Gate [n1]"
    );
  });

  test("lets a turn through that recorded in the tree", () => {
    expect(
      check([
        prompt("ship it"),
        bash("git commit -m x"),
        bash('pal cli progress stopped "committed the gate"'),
      ])
    ).toBeNull();
  });

  test("the removed pal cli work command no longer counts as recording", () => {
    const reason = check([
      prompt("ship it"),
      bash("git commit -m x"),
      bash('pal cli work stopped "x"'),
    ]);
    expect(reason).toContain("recorded nothing in the progress tree");
  });

  test.each([
    ["gh pr create --draft --title x", "opened a PR"],
    ["git checkout -b feat/x", "made a branch"],
    ["git switch -c feat/x", "made a branch"],
    ["git branch feat/x", "made a branch"],
  ])("counts %s as producing work", (command, what) => {
    expect(check([prompt("go"), bash(command)])).toContain(what);
  });

  test.each([
    "git branch -d feat/x",
    "git status",
    "git log --oneline",
    "gh pr view 12",
  ])("does not count %s", (command) => {
    expect(check([prompt("go"), bash(command)])).toBeNull();
  });

  test("counts a published artifact, not a read one", () => {
    expect(check([prompt("go"), call("Artifact", { file_path: "x.html" })])).toContain(
      "published an artifact"
    );
    expect(
      check([prompt("go"), call("Artifact", { action: "publish", file_path: "x.html" })])
    ).toContain("published an artifact");
    expect(
      check([prompt("go"), call("Artifact", { action: "read", url: "u" })])
    ).toBeNull();
  });

  test("only this turn counts: a commit before the last prompt does not", () => {
    expect(
      check([prompt("commit"), bash("git commit -m x"), prompt("thanks")])
    ).toBeNull();
  });

  test("sends a turn back only once", () => {
    const again = { ...payload, stop_hook_active: true } as StopTurnPayload;
    expect(check([prompt("go"), bash("git commit -m x")], again)).toBeNull();
  });

  test("an unreadable transcript is never sent back", () => {
    expect(progressTreeSendBack(payload, ["not json"], folder)).toBeNull();
  });

  test.each([
    "progressTree",
    "progressTreeGate",
  ])("turning %s off, or never opting into it, lets everything through", (key) => {
    setting(key, false);
    expect(check([prompt("go"), bash("git commit -m x")])).toBeNull();
    setting(key, undefined);
    expect(check([prompt("go"), bash("git commit -m x")])).toBeNull();
  });
});

describe("the decision gate", () => {
  const replied: StopTurnPayload = { session_id: "s", last_assistant_message: "Done." };
  const asked: string[][] = [];
  const decided = (decision: boolean) => async (message: string, reply: string) => {
    asked.push([message, reply]);
    return { decision, what: decision ? "PRs target canary" : "" };
  };
  const decide = (entries: unknown[], decision = true, p = replied) =>
    decisionSendBack(p, lines(entries), folder, decided(decision));

  beforeEach(() => {
    asked.length = 0;
    setting("progressTreeDecisionGate", true);
  });

  test("sends back a turn that settled a decision and recorded none", async () => {
    const reason = await decide([prompt("PRs go to canary from now on")]);
    expect(reason).toContain("This turn settled a decision (PRs target canary)");
    expect(reason).toContain("pal cli progress decide");
    expect(asked).toEqual([["PRs go to canary from now on", "Done."]]);
  });

  test("lets a turn through that settled nothing", async () => {
    expect(await decide([prompt("fix CI")], false)).toBeNull();
  });

  test("lets a turn through that recorded the decision, without asking the model", async () => {
    const entries = [
      prompt("canary"),
      bash('pal cli progress decide "PRs target canary"'),
    ];
    expect(await decide(entries)).toBeNull();
    expect(asked).toEqual([]);
  });

  test("judges only the latest user message", async () => {
    await decide([prompt("make it opt in"), prompt("thanks")]);
    expect(asked[0]?.[0]).toBe("thanks");
  });

  test("sends a turn back only once", async () => {
    const again = { ...replied, stop_hook_active: true } as StopTurnPayload;
    expect(await decide([prompt("canary")], true, again)).toBeNull();
  });

  test("asks nothing without a reply to judge", async () => {
    expect(await decide([prompt("canary")], true, payload)).toBeNull();
    expect(asked).toEqual([]);
  });

  test.each([
    "progressTree",
    "progressTreeDecisionGate",
  ])("turning %s off, or never opting into it, asks nothing", async (key) => {
    setting(key, false);
    expect(await decide([prompt("canary")])).toBeNull();
    setting(key, undefined);
    expect(await decide([prompt("canary")])).toBeNull();
    expect(asked).toEqual([]);
  });
});

describe("stopProgressTree", () => {
  const committedTurn = () => {
    const transcript = resolve(home, "transcript.jsonl");
    writeFileSync(
      transcript,
      lines([prompt("ship it"), bash("git commit -m x")]).join("\n")
    );
    return { session_id: "s", transcript_path: transcript } as StopTurnPayload;
  };

  async function stopInFolder(p: StopTurnPayload | null) {
    const saved = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = folder;
    try {
      return await stopProgressTree(p);
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = saved;
    }
  }

  test("sends back a committed turn that recorded nothing", async () => {
    expect(await stopInFolder(committedTurn())).toContain(
      "committed but recorded nothing in the progress tree"
    );
  });

  test("does nothing without a payload", async () => {
    expect(await stopInFolder(null)).toBeNull();
  });

  test("does nothing with progressTree off, even when the gate is on", async () => {
    setting("progressTree", false);
    expect(await stopInFolder(committedTurn())).toBeNull();
  });
});

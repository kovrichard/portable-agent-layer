import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/hooks/lib/settings";
import type { StopTurnPayload } from "../src/hooks/lib/stop";
import { workSession } from "../src/hooks/lib/work-session";
import { appendEvent } from "../src/hooks/lib/work-tree";
import { decisionSendBack, workTreeSendBack } from "../src/hooks/lib/work-tree-gate";
import { freshTestDir } from "./lib/test-home";

let home: string;
let folder: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  folder = resolve(home, "repo");
  mkdirSync(folder, { recursive: true });
  process.env.PAL_HOME = home;
  setting("workTree", true);
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
  workTreeSendBack(p, lines(entries), folder);

function setting(key: string, value: boolean | undefined) {
  mkdirSync(resolve(home, "memory"), { recursive: true });
  writeFileSync(
    resolve(home, "memory", "pal-settings.json"),
    JSON.stringify({
      dynamicContext: { workTree: true, workTreeGate: true, [key]: value },
    })
  );
  reload();
}

describe("the work-tree gate", () => {
  test("sends back a turn that committed and recorded nothing", () => {
    const reason = check([prompt("ship it"), bash("git commit -m 'feat: x'")]);
    expect(reason).toContain("This turn committed but recorded nothing in the work tree");
    expect(reason).toContain("pal cli work stopped");
  });

  test("names the active node so the agent knows where to record", () => {
    appendEvent(
      folder,
      "n1",
      "open",
      { title: "Gate", parent: null },
      undefined,
      undefined,
      workSession("s")
    );
    expect(check([prompt("ship it"), bash("git commit -m x")])).toContain(
      "Work: Gate [n1]"
    );
  });

  test("lets a turn through that recorded in the tree", () => {
    expect(
      check([
        prompt("ship it"),
        bash("git commit -m x"),
        bash('pal cli work stopped "committed the gate"'),
      ])
    ).toBeNull();
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
    expect(workTreeSendBack(payload, ["not json"], folder)).toBeNull();
  });

  test.each([
    "workTree",
    "workTreeGate",
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
    setting("workTreeDecisionGate", true);
  });

  test("sends back a turn that settled a decision and recorded none", async () => {
    const reason = await decide([prompt("PRs go to canary from now on")]);
    expect(reason).toContain("This turn settled a decision (PRs target canary)");
    expect(reason).toContain("pal cli work decide");
    expect(asked).toEqual([["PRs go to canary from now on", "Done."]]);
  });

  test("lets a turn through that settled nothing", async () => {
    expect(await decide([prompt("fix CI")], false)).toBeNull();
  });

  test("lets a turn through that recorded the decision, without asking the model", async () => {
    const entries = [prompt("canary"), bash('pal cli work decide "PRs target canary"')];
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
    "workTree",
    "workTreeDecisionGate",
  ])("turning %s off, or never opting into it, asks nothing", async (key) => {
    setting(key, false);
    expect(await decide([prompt("canary")])).toBeNull();
    setting(key, undefined);
    expect(await decide([prompt("canary")])).toBeNull();
    expect(asked).toEqual([]);
  });
});

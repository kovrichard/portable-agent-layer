import { describe, expect, test } from "bun:test";
import {
  checkClaims,
  commandsThisTurn,
  resultClaims,
  statusClaims,
} from "../src/hooks/lib/claim-check";

function claude(entries: unknown[]): string[] {
  return entries.map((e) => JSON.stringify(e));
}

const prompt = (text: string) => ({ type: "user", message: { content: text } });
const toolUse = (name: string, input: Record<string, unknown> = {}) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name, input }] },
});
const toolResult = () => ({
  type: "user",
  message: { content: [{ type: "tool_result", content: "ok" }] },
});
const said = (text: string) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
});

describe("finding result claims in a reply", () => {
  test.each([
    "All tests pass.",
    "The suite is green now",
    "CI passed on all three runners.",
    "The build succeeded",
    "Verified: the hook fires once.",
    "The upload works now.",
  ])("a claim: %s", (reply) => {
    expect(resultClaims(reply)).toHaveLength(1);
  });

  test.each([
    "The tests should pass once the fixture is fixed.",
    "CI is not green yet.",
    "Run the tests when you are back.",
    "Two tests failed on Windows.",
    "I renamed the queue worker.",
    'The hook flags a reply that says "tests pass" with nothing run.',
    "It sends back “CI is green” claims it cannot see.",
  ])("not a claim: %s", (reply) => {
    expect(resultClaims(reply)).toEqual([]);
  });

  test("names each claiming sentence, not the whole reply", () => {
    expect(resultClaims("Renamed the worker. All tests pass. Want me to push?")).toEqual([
      "All tests pass",
    ]);
  });
});

describe("finding status claims in a reply", () => {
  test.each([
    "The branch is not pushed yet.",
    "Those changes are still uncommitted.",
    "PR #55 isn't merged.",
    "0.85.19 hasn't been released.",
    "It's merged and tagged.",
    "The fix is not deployed to production.",
    "The new version is live.",
  ])("a claim: %s", (reply) => {
    expect(statusClaims(reply)).toHaveLength(1);
  });

  test.each([
    "Once it is pushed, CI runs.",
    "If it isn't merged by tonight, ping me.",
    "I'll push after you review.",
    "Is it merged?",
    "- [ ] C-A1: No credential is committed",
    "**To verify the new version is live:**",
    'The rule catches replies that say "not pushed" from memory.',
    "Renamed the worker.",
  ])("not a claim: %s", (reply) => {
    expect(statusClaims(reply)).toEqual([]);
  });
});

describe("counting the commands run this turn", () => {
  test("counts command tools after the user's last prompt only", () => {
    const lines = claude([
      prompt("run the tests"),
      toolUse("Bash"),
      toolResult(),
      said("done"),
      prompt("now push"),
      toolUse("Edit"),
      toolResult(),
      toolUse("Bash"),
      toolResult(),
    ]);

    expect(commandsThisTurn(lines)).toHaveLength(1);
  });

  test("an edit or a read is not a command that shows a result", () => {
    const lines = claude([prompt("fix it"), toolUse("Edit"), toolUse("Read")]);

    expect(commandsThisTurn(lines)).toEqual([]);
  });

  test("a notification injected mid-turn does not start a new turn", () => {
    const lines = claude([
      prompt("run the tests"),
      toolUse("Bash"),
      prompt("<task-notification>done</task-notification>"),
    ]);

    expect(commandsThisTurn(lines)).toHaveLength(1);
  });

  test("reads a Codex turn", () => {
    const lines = [
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "run it" }],
        },
      },
      {
        type: "response_item",
        payload: { type: "custom_tool_call", name: "exec", input: "bun test" },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "shell",
          arguments: '{"command":["git","status"]}',
        },
      },
    ].map((e) => JSON.stringify(e));

    const commands = commandsThisTurn(lines);
    expect(commands).toHaveLength(2);
    expect(checkClaims("The branch is not pushed yet.", commands).verdict).toBe("backed");
  });

  test("a transcript it cannot read gives no count rather than zero", () => {
    expect(commandsThisTurn(["not json", JSON.stringify({ type: "other" })])).toBeNull();
  });
});

describe("the commands run this turn", () => {
  test("keep what each command ran, so a claim can ask which state was read", () => {
    const lines = claude([
      prompt("is it pushed"),
      toolUse("Bash", { command: "git status -sb" }),
      toolUse("Edit", { file_path: "a.ts" }),
    ]);

    expect(commandsThisTurn(lines)).toEqual(['{"command":"git status -sb"}']);
  });
});

describe("judging the reply", () => {
  test("a claim with no command behind it is unbacked", () => {
    expect(checkClaims("All tests pass.", [])).toEqual({
      verdict: "unbacked",
      claims: ["All tests pass"],
    });
  });

  test("a claim after a command ran is backed", () => {
    expect(checkClaims("All tests pass.", ["bun test", "ls"]).verdict).toBe("backed");
  });

  test("a claim in a turn that could not be read is unknown, never unbacked", () => {
    expect(checkClaims("All tests pass.", null).verdict).toBe("unknown");
  });

  test("a reply that claims nothing is not judged", () => {
    expect(checkClaims("Renamed the worker.", [])).toEqual({
      verdict: "none",
      claims: [],
    });
  });

  test("what is pushed or merged is backed only by a command that read git", () => {
    expect(checkClaims("The branch is not pushed yet.", ["bun test"])).toEqual({
      verdict: "unbacked",
      claims: ["The branch is not pushed yet"],
    });
    expect(checkClaims("The branch is not pushed yet.", ["git status -sb"]).verdict).toBe(
      "backed"
    );
    expect(checkClaims("PR #55 isn't merged.", ["gh pr view 55"]).verdict).toBe("backed");
  });

  test("what is deployed is backed by any command, since the target varies", () => {
    expect(checkClaims("The new version is live.", ["curl -sI https://x"]).verdict).toBe(
      "backed"
    );
  });

  test("only the claims nothing backed are named", () => {
    expect(
      checkClaims("All tests pass. The branch is not pushed yet.", ["bun test"])
    ).toEqual({ verdict: "unbacked", claims: ["The branch is not pushed yet"] });
  });
});

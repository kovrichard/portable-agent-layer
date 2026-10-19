import { describe, expect, test } from "bun:test";
import {
  decisionRequest,
  decisionUser,
  parseDecision,
} from "../src/hooks/lib/decision-label";
import { inferenceModel } from "../src/hooks/lib/models";

describe("parseDecision", () => {
  test("a decision keeps what was decided", () => {
    const output = JSON.stringify({ decision: true, what: " PRs target canary " });
    expect(parseDecision(output)).toEqual({ decision: true, what: "PRs target canary" });
  });

  test("no decision drops any stray text", () => {
    const output = JSON.stringify({ decision: false, what: "nothing much" });
    expect(parseDecision(output)).toEqual({ decision: false, what: "" });
  });

  test("an answer without a boolean decision is no label", () => {
    expect(parseDecision(JSON.stringify({ decision: "yes", what: "x" }))).toBeNull();
    expect(parseDecision("not json")).toBeNull();
    expect(parseDecision(null)).toBeNull();
  });
});

describe("decisionRequest", () => {
  test("sends the start of the message and the end of the reply", () => {
    const user = decisionUser(`${"m".repeat(1500)}CUT`, `CUT${"r".repeat(1500)}`);
    expect(user).not.toContain("CUT");
    expect(user).toContain("<message>\nm");
    expect(user).toContain("r\n</reply_end>");
  });

  test("runs as its own caller on Haiku 5.5", () => {
    const request = decisionRequest("make it opt in", "Done.");
    expect(request.caller).toBe("decision-label");
    expect(inferenceModel("claude-spawn", "small", request.caller)).toBe(
      "claude-haiku-5-5"
    );
  });
});

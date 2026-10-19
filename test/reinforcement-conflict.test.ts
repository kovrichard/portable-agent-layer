import { beforeEach, describe, expect, test } from "bun:test";
import {
  type AdaptationRule,
  addReinforcement,
  flagContradiction,
  readRules,
} from "../src/hooks/lib/adaptation-rules";
import { conflictRequest, parseConflict } from "../src/hooks/lib/reinforcement-conflict";
import { freshTestDir } from "./lib/test-home";

beforeEach(() => {
  process.env.PAL_HOME = freshTestDir(import.meta.file);
});

function kept(): AdaptationRule {
  const result = addReinforcement({
    when: "The user counter-proposes",
    steering: "Argue again with the reason.",
    evidence: [],
  });
  if (!result.ok) throw new Error(result.reason);
  return result.rule;
}

describe("parseConflict", () => {
  test("an id from the list names that reinforcement", () => {
    const rule = kept();
    expect(parseConflict(JSON.stringify({ id: rule.id }), [rule])).toEqual(rule);
  });

  test("an empty, unknown or broken answer names none", () => {
    const rule = kept();
    expect(parseConflict(JSON.stringify({ id: "" }), [rule])).toBeNull();
    expect(parseConflict(JSON.stringify({ id: "nope" }), [rule])).toBeNull();
    expect(parseConflict("not json", [rule])).toBeNull();
    expect(parseConflict(null, [rule])).toBeNull();
  });
});

test("the request lists each kept behavior by id beside the correction", () => {
  const rule = kept();
  const request = conflictRequest("stop arguing", "argued instead of doing", [rule]);
  expect(request.user).toContain(`- ${rule.id}: The user counter-proposes`);
  expect(request.user).toContain("stop arguing");
});

test("flagging marks the reinforcement and leaves it approved", () => {
  const rule = kept();
  flagContradiction(rule.id, "stop arguing, just do it");

  const [stored] = readRules();
  expect(stored.status).toBe("approved");
  expect(stored.contradicted?.message).toBe("stop arguing, just do it");
});

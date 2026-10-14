import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  CORRECTION_KINDS,
  correctionKindRequest,
  correctionKindUser,
  needsCorrectionKind,
  parseCorrectionKind,
  withCorrectionKind,
} from "../src/hooks/lib/correction-kind";

const CONFIG = resolve(import.meta.dir, "../eval/correction-kind/promptfoo.yaml");

describe("parseCorrectionKind", () => {
  test("a listed kind drops any suggestion", () => {
    const output = JSON.stringify({
      kind: "unverified-claim",
      suggested: "ci-claim",
      description: "said CI was green",
    });
    expect(parseCorrectionKind(output)).toEqual({
      kind: "unverified-claim",
      suggested: "",
      description: "",
    });
  });

  test("other keeps the model's name and description", () => {
    const output = JSON.stringify({
      kind: "other",
      suggested: " destructive-action ",
      description: "Deleted files without asking.",
    });
    expect(parseCorrectionKind(output)).toEqual({
      kind: "other",
      suggested: "destructive-action",
      description: "Deleted files without asking.",
    });
  });

  test("a kind outside the set becomes an other suggestion, not a loss", () => {
    const output = JSON.stringify({
      kind: "tone",
      suggested: "",
      description: "Too curt.",
    });
    expect(parseCorrectionKind(output)).toEqual({
      kind: "other",
      suggested: "tone",
      description: "Too curt.",
    });
  });

  test("no kind at all, or no JSON, is no label", () => {
    expect(
      parseCorrectionKind(JSON.stringify({ kind: "", description: "x" }))
    ).toBeNull();
    expect(parseCorrectionKind("not json")).toBeNull();
    expect(parseCorrectionKind("")).toBeNull();
  });
});

describe("correctionKindRequest", () => {
  test("offers every kind, other last, under its own caller", () => {
    const request = correctionKindRequest("reply", "msg", "issue");
    expect(request.caller).toBe("correction-kind");
    expect(request.jsonSchema.properties.kind.enum).toEqual([...CORRECTION_KINDS]);
    expect(CORRECTION_KINDS.at(-1)).toBe("other");
    for (const kind of CORRECTION_KINDS) expect(request.system).toContain(`- ${kind}:`);
  });
});

describe("storing a kind on a turn", () => {
  const turn = {
    session: "s",
    message: "m",
    replyEnd: "r",
    reaction: "corrected",
    issue: "i",
  };

  test("only a confirmed correction is labelled", () => {
    expect(needsCorrectionKind({ ...turn, confirmed: true })).toBe(true);
    expect(needsCorrectionKind({ ...turn, confirmed: false })).toBe(false);
    expect(needsCorrectionKind({ ...turn, reaction: "approved" })).toBe(false);
    expect(needsCorrectionKind(null)).toBe(false);
  });

  test("a turn without a kind is stored as it was", () => {
    expect(withCorrectionKind(turn, null)).toEqual(turn);
  });
});

async function evalUserPrompt(vars: Record<string, string>): Promise<string> {
  const config = Bun.YAML.parse(await Bun.file(CONFIG).text()) as {
    prompts: { raw: string }[];
  };
  return Object.entries(vars)
    .reduce(
      (raw, [name, value]) => raw.replace(`{{${name}}}`, value),
      config.prompts[0].raw
    )
    .trimEnd();
}

test("the correction-kind eval sends the user prompt correctionKindUser builds", async () => {
  const vars = { replyEnd: "The end.", message: "Wrong.", issue: "Got it wrong." };
  expect(await evalUserPrompt(vars)).toBe(
    correctionKindUser(vars.replyEnd, vars.message, vars.issue)
  );
});

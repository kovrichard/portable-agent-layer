import { beforeEach, expect, test } from "bun:test";
import { appendEvent } from "../src/hooks/lib/events";
import { reload } from "../src/hooks/lib/settings";
import { palInferenceEvents } from "../src/tools/token-cost";
import { freshTestDir } from "./lib/test-home";

beforeEach(() => {
  process.env.PAL_HOME = freshTestDir(import.meta.file);
  reload();
});

test("palInferenceEvents returns inference_call and judge_call events and nothing else", () => {
  appendEvent(
    "judge_call",
    { caller: "rating", model: "jev-1.14.0", inputTokens: 1000 },
    {
      session: null,
    }
  );
  appendEvent(
    "inference_call",
    { caller: "rating", model: "claude-haiku-4-5" },
    {
      session: null,
    }
  );
  appendEvent("session_start", {}, { session: null });

  const types = palInferenceEvents().map((e) => e.type);
  expect(types.sort()).toEqual(["inference_call", "judge_call"]);
});

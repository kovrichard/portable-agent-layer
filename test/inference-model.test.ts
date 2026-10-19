import { beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import {
  buildClaudeArgs,
  buildCodexArgs,
  buildCopilotArgs,
  buildCursorArgs,
  buildOpenAiBody,
  buildOpencodeArgs,
  inference,
  plannedInferenceRoute,
  previewInferenceRoute,
} from "../src/hooks/lib/inference";
import {
  FABLE_MODEL,
  HAIKU_5_5_MODEL,
  HAIKU_MODEL,
  inferenceEffort,
  inferenceModel,
  isFixedModelRoute,
  OPUS_MODEL,
  SONNET_MODEL,
} from "../src/hooks/lib/models";
import { opencodeTierModel } from "../src/hooks/lib/opencode-config";
import { freshTestDir } from "./lib/test-home";

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

describe("inferenceModel", () => {
  test("claude routes use Haiku for small and Sonnet 5.5 for medium", () => {
    expect(SONNET_MODEL).toBe("claude-sonnet-5-5");
    expect(inferenceModel("claude-spawn", "small")).toBe(HAIKU_MODEL);
    expect(inferenceModel("claude-spawn", "medium")).toBe(SONNET_MODEL);
    expect(inferenceModel("anthropic-api", "small")).toBe(HAIKU_MODEL);
    expect(inferenceModel("anthropic-api", "medium")).toBe(SONNET_MODEL);
  });

  test("the agy route steps Gemini Flash through low, medium and high effort", () => {
    expect(inferenceModel("antigravity-spawn", "small")).toBe("gemini-3.8-flash-low");
    expect(inferenceModel("antigravity-spawn", "medium")).toBe("gemini-3.8-flash-medium");
    expect(inferenceModel("antigravity-spawn", "large")).toBe("gemini-3.8-flash-high");
  });

  test("large is Opus 5.5 on the claude routes and GPT-6 Sol on the openai routes", () => {
    expect(OPUS_MODEL).toBe("claude-opus-5-5");
    expect(inferenceModel("claude-spawn", "large")).toBe(OPUS_MODEL);
    expect(inferenceModel("anthropic-api", "large")).toBe(OPUS_MODEL);
    expect(inferenceModel("codex-spawn", "large")).toBe("gpt-6-sol");
    expect(inferenceModel("openai-api", "large")).toBe("gpt-6-sol");
  });

  test("openai large runs Sol at high effort; other tiers keep the model's default", () => {
    expect(inferenceEffort("codex-spawn", "large")).toBe("high");
    expect(inferenceEffort("openai-api", "large")).toBe("high");
    expect(inferenceEffort("codex-spawn", "medium")).toBeUndefined();
    expect(inferenceEffort("claude-spawn", "large")).toBeUndefined();
  });

  test("openai routes use gpt-6-luna for small", () => {
    expect(inferenceModel("codex-spawn", "small")).toBe("gpt-6-luna");
    expect(inferenceModel("openai-api", "small")).toBe("gpt-6-luna");
  });

  test("only routes with a fixed table count as fixed", () => {
    expect(isFixedModelRoute("codex-spawn")).toBe(true);
    expect(isFixedModelRoute("antigravity-spawn")).toBe(true);
    expect(isFixedModelRoute("copilot-spawn")).toBe(false);
    expect(isFixedModelRoute("cursor-spawn")).toBe(false);
    expect(isFixedModelRoute("opencode-spawn")).toBe(false);
  });

  test("the rule drafter runs on Haiku 5.5 on the claude routes", () => {
    expect(inferenceModel("claude-spawn", "small", "rule-drafter")).toBe(HAIKU_5_5_MODEL);
    expect(inferenceModel("anthropic-api", "small", "rule-drafter")).toBe(
      HAIKU_5_5_MODEL
    );
  });

  test("the correction-kind labeller runs on Haiku 5.5 on the claude routes", () => {
    expect(inferenceModel("claude-spawn", "small", "correction-kind")).toBe(
      HAIKU_5_5_MODEL
    );
    expect(inferenceModel("anthropic-api", "small", "correction-kind")).toBe(
      HAIKU_5_5_MODEL
    );
  });

  test("a caller nobody evaluated stays on the route's own model", () => {
    expect(inferenceModel("claude-spawn", "small", "rating")).toBe(HAIKU_MODEL);
    expect(inferenceModel("codex-spawn", "small", "rule-drafter")).toBe("gpt-6-luna");
  });

  test("flagship is Fable 5.1 on the claude routes and GPT-6 Astra on the openai routes", () => {
    expect(inferenceModel("claude-spawn", "flagship")).toBe(FABLE_MODEL);
    expect(inferenceModel("anthropic-api", "flagship")).toBe(FABLE_MODEL);
    expect(inferenceModel("codex-spawn", "flagship")).toBe("gpt-6-astra");
    expect(inferenceModel("openai-api", "flagship")).toBe("gpt-6-astra");
  });

  test("a flagship call on a route without a flagship model says so", () => {
    expect(() => inferenceModel("antigravity-spawn", "flagship")).toThrow(
      "antigravity-spawn has no flagship model"
    );
  });

  test("a caller evaluated on Haiku 5.5 still gets the tier it asks for above small", () => {
    expect(inferenceModel("claude-spawn", "medium", "rule-drafter")).toBe(SONNET_MODEL);
    expect(inferenceModel("claude-spawn", "flagship", "rule-drafter")).toBe(FABLE_MODEL);
  });

  test("small is the default tier", () => {
    expect(inferenceModel("codex-spawn")).toBe(inferenceModel("codex-spawn", "small"));
  });

  test("small and medium differ on every fixed route", () => {
    for (const route of [
      "claude-spawn",
      "anthropic-api",
      "codex-spawn",
      "openai-api",
      "antigravity-spawn",
    ] as const) {
      expect(inferenceModel(route, "small")).not.toBe(inferenceModel(route, "medium"));
    }
  });
});

describe("argv carries the tier's model", () => {
  test("claude defaults to Haiku", () => {
    expect(flagValue(buildClaudeArgs({ user: "hi" }), "--model")).toBe(HAIKU_MODEL);
  });

  test("claude passes the caller's evaluated model", () => {
    const args = buildClaudeArgs({ user: "hi", caller: "rule-drafter" });
    expect(flagValue(args, "--model")).toBe(HAIKU_5_5_MODEL);
  });

  test("claude medium uses Sonnet", () => {
    const args = buildClaudeArgs({ user: "hi", tier: "medium" });
    expect(flagValue(args, "--model")).toBe(SONNET_MODEL);
  });

  test("claude flagship uses Fable", () => {
    const args = buildClaudeArgs({ user: "hi", tier: "flagship" });
    expect(flagValue(args, "--model")).toBe(FABLE_MODEL);
  });

  test("codex large passes Sol and its high reasoning effort", () => {
    const args = buildCodexArgs({ user: "hi", tier: "large" });
    expect(flagValue(args, "-m")).toBe("gpt-6-sol");
    expect(args).toContain('model_reasoning_effort="high"');
  });

  test("codex medium leaves the reasoning effort to the model", () => {
    const args = buildCodexArgs({ user: "hi", tier: "medium" });
    expect(args.some((arg) => arg.startsWith("model_reasoning_effort"))).toBe(false);
  });

  test("the openai api body carries the large tier's reasoning effort", () => {
    expect(buildOpenAiBody({ user: "hi", tier: "large" }).reasoning_effort).toBe("high");
    expect(buildOpenAiBody({ user: "hi", tier: "medium" })).not.toHaveProperty(
      "reasoning_effort"
    );
  });

  test("codex passes its small model with -m", () => {
    expect(flagValue(buildCodexArgs({ user: "hi" }), "-m")).toBe(
      inferenceModel("codex-spawn", "small")
    );
  });

  test("codex medium passes its medium model", () => {
    expect(flagValue(buildCodexArgs({ user: "hi", tier: "medium" }), "-m")).toBe(
      inferenceModel("codex-spawn", "medium")
    );
  });

  test("copilot and cursor leave the model to the user's plan", () => {
    expect(buildCopilotArgs({ user: "hi", tier: "medium" })).not.toContain("--model");
    expect(buildCursorArgs({ user: "hi", tier: "medium" })).not.toContain("--model");
  });
});

describe("opencode picks from the user's own config", () => {
  let dir: string;

  beforeEach(() => {
    dir = freshTestDir(import.meta.file);
    process.env.PAL_OPENCODE_DIR = dir;
  });

  function writeConfig(config: Record<string, unknown>) {
    writeFileSync(resolve(dir, "config.json"), JSON.stringify(config));
  }

  test("small uses small_model when set", () => {
    writeConfig({ model: "acme/big", small_model: "acme/tiny" });
    expect(opencodeTierModel("small")).toBe("acme/tiny");
    expect(flagValue(buildOpencodeArgs({ user: "hi" }), "-m")).toBe("acme/tiny");
  });

  test("small falls back to model without small_model", () => {
    writeConfig({ model: "acme/big" });
    expect(opencodeTierModel("small")).toBe("acme/big");
  });

  test("medium uses model even when small_model is set", () => {
    writeConfig({ model: "acme/big", small_model: "acme/tiny" });
    expect(opencodeTierModel("medium")).toBe("acme/big");
  });

  test("no -m flag when nothing is configured", () => {
    expect(buildOpencodeArgs({ user: "hi" })).not.toContain("-m");
  });
});

describe("previewInferenceRoute", () => {
  test("reports no model for a plan-picked route", () => {
    delete process.env.PAL_INFERENCE_DISABLED;
    process.env.PAL_AGENT = "copilot";
    const preview = previewInferenceRoute();
    if (preview.route === "copilot-spawn") expect(preview.model).toBeUndefined();
  });

  test("reports the small model of the route it picks", () => {
    delete process.env.PAL_INFERENCE_DISABLED;
    process.env.PAL_AGENT = "claude";
    const preview = previewInferenceRoute();
    if (preview.route === "claude-spawn" || preview.route === "anthropic-api")
      expect(preview.model).toBe(HAIKU_MODEL);
    else expect(preview.model).toBeUndefined();
  });
});

function pathWithFakeAgent(binary: string): string {
  const dir = freshTestDir(`${import.meta.file}-planned-${binary}`);
  const name = process.platform === "win32" ? `${binary}.cmd` : binary;
  writeFileSync(resolve(dir, name), "");
  chmodSync(resolve(dir, name), 0o755);
  return `${dir}${delimiter}${process.env.PATH ?? ""}`;
}

describe("plannedInferenceRoute", () => {
  test("names the agent, its route and the model for the tier asked", () => {
    const realPath = process.env.PATH;
    delete process.env.PAL_INFERENCE_DISABLED;
    process.env.PAL_AGENT = "claude";
    process.env.PATH = pathWithFakeAgent("claude");
    try {
      expect(plannedInferenceRoute("medium")).toEqual({
        agent: "claude",
        route: "claude-spawn",
        model: SONNET_MODEL,
      });
      expect(plannedInferenceRoute("small").model).toBe(HAIKU_MODEL);
    } finally {
      process.env.PATH = realPath;
    }
  });
});

describe("inference on a tier the route lacks", () => {
  test("fails with the reason instead of throwing", async () => {
    const realPath = process.env.PATH;
    delete process.env.PAL_INFERENCE_DISABLED;
    process.env.PAL_AGENT = "antigravity";
    process.env.PATH = pathWithFakeAgent("agy");
    try {
      expect(await inference({ user: "hi", tier: "flagship" })).toEqual({
        success: false,
        error: "antigravity-spawn has no flagship model",
      });
    } finally {
      process.env.PATH = realPath;
      process.env.PAL_INFERENCE_DISABLED = "1";
    }
  });
});

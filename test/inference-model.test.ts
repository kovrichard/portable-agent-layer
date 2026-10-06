import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  buildClaudeArgs,
  buildCodexArgs,
  buildCopilotArgs,
  buildCursorArgs,
  buildOpencodeArgs,
  previewInferenceRoute,
} from "../src/hooks/lib/inference";
import {
  HAIKU_MODEL,
  inferenceModel,
  isFixedModelRoute,
  SONNET_MODEL,
} from "../src/hooks/lib/models";
import { opencodeTierModel } from "../src/hooks/lib/opencode-config";

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

describe("inferenceModel", () => {
  test("claude routes use Haiku for small and Sonnet for medium", () => {
    expect(inferenceModel("claude-spawn", "small")).toBe(HAIKU_MODEL);
    expect(inferenceModel("claude-spawn", "medium")).toBe(SONNET_MODEL);
    expect(inferenceModel("anthropic-api", "small")).toBe(HAIKU_MODEL);
    expect(inferenceModel("anthropic-api", "medium")).toBe(SONNET_MODEL);
  });

  test("openai routes use gpt-6-luna for small", () => {
    expect(inferenceModel("codex-spawn", "small")).toBe("gpt-6-luna");
    expect(inferenceModel("openai-api", "small")).toBe("gpt-6-luna");
  });

  test("only routes with a fixed table count as fixed", () => {
    expect(isFixedModelRoute("codex-spawn")).toBe(true);
    expect(isFixedModelRoute("copilot-spawn")).toBe(false);
    expect(isFixedModelRoute("cursor-spawn")).toBe(false);
    expect(isFixedModelRoute("opencode-spawn")).toBe(false);
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
    ] as const) {
      expect(inferenceModel(route, "small")).not.toBe(inferenceModel(route, "medium"));
    }
  });
});

describe("argv carries the tier's model", () => {
  test("claude defaults to Haiku", () => {
    expect(flagValue(buildClaudeArgs({ user: "hi" }), "--model")).toBe(HAIKU_MODEL);
  });

  test("claude medium uses Sonnet", () => {
    const args = buildClaudeArgs({ user: "hi", tier: "medium" });
    expect(flagValue(args, "--model")).toBe(SONNET_MODEL);
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
  const saved = process.env.PAL_OPENCODE_DIR;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "pal-oc-tier-"));
    process.env.PAL_OPENCODE_DIR = dir;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (saved === undefined) delete process.env.PAL_OPENCODE_DIR;
    else process.env.PAL_OPENCODE_DIR = saved;
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
  const saved = {
    agent: process.env.PAL_AGENT,
    disabled: process.env.PAL_INFERENCE_DISABLED,
  };
  afterEach(() => {
    for (const [k, v] of [
      ["PAL_AGENT", saved.agent],
      ["PAL_INFERENCE_DISABLED", saved.disabled],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

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

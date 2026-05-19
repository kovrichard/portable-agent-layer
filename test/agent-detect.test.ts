import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getActiveAgent,
  isClaude,
  isCodex,
  isCopilot,
  isCursor,
  isOpencode,
} from "../src/hooks/lib/agent";

const PRESERVED_ENV_KEYS = [
  "PAL_AGENT",
  "CURSOR_VERSION",
  "CODEX_CLI_VERSION",
  "OPENAI_CODEX",
] as const;

describe("getActiveAgent — PAL_AGENT env signal", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of PRESERVED_ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of PRESERVED_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("defaults to claude when nothing is set", () => {
    expect(getActiveAgent()).toBe("claude");
    expect(isClaude()).toBe(true);
  });

  test("detects claude when PAL_AGENT=claude", () => {
    process.env.PAL_AGENT = "claude";
    expect(getActiveAgent()).toBe("claude");
    expect(isClaude()).toBe(true);
  });

  test("detects cursor when PAL_AGENT=cursor", () => {
    process.env.PAL_AGENT = "cursor";
    expect(getActiveAgent()).toBe("cursor");
    expect(isCursor()).toBe(true);
  });

  test("detects codex when PAL_AGENT=codex", () => {
    process.env.PAL_AGENT = "codex";
    expect(getActiveAgent()).toBe("codex");
    expect(isCodex()).toBe(true);
  });

  test("detects copilot when PAL_AGENT=copilot", () => {
    process.env.PAL_AGENT = "copilot";
    expect(getActiveAgent()).toBe("copilot");
    expect(isCopilot()).toBe(true);
  });

  test("detects opencode when PAL_AGENT=opencode", () => {
    process.env.PAL_AGENT = "opencode";
    expect(getActiveAgent()).toBe("opencode");
    expect(isOpencode()).toBe(true);
  });

  test("falls back to CURSOR_VERSION when PAL_AGENT is absent", () => {
    process.env.CURSOR_VERSION = "1.0.0";
    expect(getActiveAgent()).toBe("cursor");
  });

  test("falls back to CODEX_CLI_VERSION when PAL_AGENT is absent", () => {
    process.env.CODEX_CLI_VERSION = "0.130.0";
    expect(getActiveAgent()).toBe("codex");
  });

  test("PAL_AGENT wins over IDE env-var fallbacks", () => {
    process.env.PAL_AGENT = "copilot";
    process.env.CURSOR_VERSION = "1.0.0";
    expect(getActiveAgent()).toBe("copilot");
  });

  test("predicates are mutually exclusive", () => {
    process.env.PAL_AGENT = "copilot";
    expect([isClaude(), isCodex(), isCopilot(), isCursor(), isOpencode()]).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  test("unknown PAL_AGENT value falls back to claude", () => {
    process.env.PAL_AGENT = "bogus";
    expect(getActiveAgent()).toBe("claude");
  });
});

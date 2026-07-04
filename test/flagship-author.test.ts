import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  FABLE_MODEL,
  FLAGSHIP_AUTHOR_MODEL,
  flagshipAuthorModel,
} from "../src/hooks/lib/models";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");

function authorModel(agent: string | undefined) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.CURSOR_VERSION;
  delete env.CODEX_CLI_VERSION;
  delete env.OPENAI_CODEX;
  if (agent === undefined) delete env.PAL_AGENT;
  else env.PAL_AGENT = agent;
  return spawnSync("bun", ["run", CLI, "cli", "skill", "author-model"], {
    env,
    encoding: "utf-8",
    timeout: 15000,
  });
}

describe("flagship authoring registry", () => {
  test("claude resolves to Fable 5", () => {
    expect(flagshipAuthorModel("claude")).toBe(FABLE_MODEL);
    expect(FABLE_MODEL).toBe("claude-fable-5");
  });

  test("agents without a configured flagship resolve to undefined (inline path)", () => {
    expect(flagshipAuthorModel("codex")).toBeUndefined();
    expect(flagshipAuthorModel("opencode")).toBeUndefined();
    expect(flagshipAuthorModel("cursor")).toBeUndefined();
    expect(flagshipAuthorModel("copilot")).toBeUndefined();
  });

  test("registry is opt-in per agent — only entries present are configured", () => {
    // Guards the extensibility contract: adding a provider is one entry here.
    expect(Object.keys(FLAGSHIP_AUTHOR_MODEL)).toEqual(["claude"]);
  });
});

describe("pal cli skill author-model", () => {
  test("prints the flagship model for claude", () => {
    const r = authorModel("claude");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(FABLE_MODEL);
  });

  test("prints nothing for an agent with no flagship — drives inline authoring", () => {
    const r = authorModel("codex");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});

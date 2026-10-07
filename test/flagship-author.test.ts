import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_NAMES } from "../src/hooks/lib/agent-registry";
import { FABLE_MODEL, flagshipAuthorModel } from "../src/hooks/lib/models";
import { renderAgentForPlatform } from "../src/targets/agent-render";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const AGENTS_DIR = resolve(import.meta.dir, "../assets/agents");

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

  test("codex resolves to GPT-6 Astra", () => {
    expect(flagshipAuthorModel("codex")).toBe("gpt-6-astra");
  });

  test("agents without a configured flagship resolve to undefined (inline path)", () => {
    expect(flagshipAuthorModel("opencode")).toBeUndefined();
    expect(flagshipAuthorModel("cursor")).toBeUndefined();
    expect(flagshipAuthorModel("copilot")).toBeUndefined();
  });

  test("only agents whose route has a large model author through a flagship", () => {
    expect(AGENT_NAMES.filter((agent) => flagshipAuthorModel(agent))).toEqual([
      "claude",
      "codex",
    ]);
  });

  test("each flagship author subagent pins its agent's large model", () => {
    for (const stem of ["skill-author", "subagent-author"]) {
      const content = readFileSync(resolve(AGENTS_DIR, `${stem}.md`), "utf-8");
      const codex = renderAgentForPlatform(content, "codex");
      expect(codex).toContain(`model = "${flagshipAuthorModel("codex")}"`);
    }
  });
});

describe("pal cli skill author-model", () => {
  test("prints the flagship model for claude", () => {
    const r = authorModel("claude");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(FABLE_MODEL);
  });

  test("prints the flagship model for codex", () => {
    const r = authorModel("codex");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("gpt-6-astra");
  });

  test("prints nothing for an agent with no flagship — drives inline authoring", () => {
    const r = authorModel("opencode");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});

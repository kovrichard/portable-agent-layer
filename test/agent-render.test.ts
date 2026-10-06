import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_PLATFORMS } from "../src/hooks/lib/agent-definition";
import { agentFileName, renderAgentForPlatform } from "../src/targets/agent-render";

const SHIPPED = resolve(import.meta.dir, "../assets/agents");

const MERGED = `---
name: my-helper
description: "Reviews diffs: finds bugs. Use when a diff needs a bug pass."
claude:
  tools: Read, Grep
  model: sonnet
codex:
  model: gpt-6-sol
  model_reasoning_effort: high
  sandbox_mode: read-only
  nickname_candidates:
    - Ada
    - Grace
---

You review diffs.

---
Return findings only.
`;

const codexToml = (content: string) =>
  Bun.TOML.parse(renderAgentForPlatform(content, "codex")) as Record<string, unknown>;

describe("codex agent rendering", () => {
  test("maps the shared fields and body onto the three required keys", () => {
    const agent = codexToml(MERGED);

    expect(agent.name).toBe("my-helper");
    expect(agent.description).toBe(
      "Reviews diffs: finds bugs. Use when a diff needs a bug pass."
    );
    expect(agent.developer_instructions).toBe(
      "You review diffs.\n\n---\nReturn findings only.\n"
    );
  });

  test("lifts the codex block's keys to the top level", () => {
    const agent = codexToml(MERGED);

    expect(agent.model).toBe("gpt-6-sol");
    expect(agent.model_reasoning_effort).toBe("high");
    expect(agent.sandbox_mode).toBe("read-only");
    expect(agent.nickname_candidates).toEqual(["Ada", "Grace"]);
  });

  test("leaves every other platform's block out", () => {
    const agent = codexToml(MERGED);

    expect(agent.tools).toBeUndefined();
    expect(agent.model).not.toBe("sonnet");
  });

  test("an agent with no codex block renders from the shared fields alone", () => {
    const agent = codexToml(MERGED.replace(/codex:\n( {2}.*\n)+/, ""));

    expect(Object.keys(agent).sort()).toEqual([
      "description",
      "developer_instructions",
      "name",
    ]);
  });

  test("a body containing a TOML literal delimiter still round-trips", () => {
    const tricky = MERGED.replace("You review diffs.", "Quote it as ''' and \"so\".");

    expect(codexToml(tricky).developer_instructions).toStartWith(
      "Quote it as ''' and \"so\"."
    );
  });

  test.each([
    ["a nested table value", "codex:\n  mcp_servers:\n    docs:\n      url: x\n"],
    ["an override of a shared field", "codex:\n  name: other\n"],
    ["a global field Codex has no key for", "color: blue\ncodex:\n  model: gpt-5\n"],
  ])("refuses %s instead of dropping it", (_case, frontmatterTail) => {
    const content = `---\nname: my-helper\ndescription: "Does a thing."\n${frontmatterTail}---\nBody.\n`;

    expect(() => renderAgentForPlatform(content, "codex")).toThrow();
  });

  test("refuses a definition without a name", () => {
    expect(() =>
      renderAgentForPlatform('---\ndescription: "x"\n---\nBody.\n', "codex")
    ).toThrow("name");
  });
});

describe("body fidelity", () => {
  const ruled = MERGED.replace(
    "---\nReturn findings only.",
    "---\n\nReturn findings only."
  );

  test("markdown output reproduces the source body byte for byte", () => {
    const body = (text: string) => text.slice(text.indexOf("\n---\n", 4));
    expect(body(renderAgentForPlatform(ruled, "claude"))).toBe(body(ruled));
  });

  test("codex instructions keep a blank line after a horizontal rule", () => {
    expect(codexToml(ruled).developer_instructions).toBe(
      "You review diffs.\n\n---\n\nReturn findings only.\n"
    );
  });
});

describe("markdown agent rendering", () => {
  test("a codex block never leaks into another platform's frontmatter", () => {
    const claude = renderAgentForPlatform(MERGED, "claude");

    expect(claude).toContain("model: sonnet");
    expect(claude).not.toContain("codex");
    expect(claude).not.toContain("sandbox_mode");
    expect(claude).not.toContain("Ada");
  });
});

describe("shipped agents", () => {
  const sources = readdirSync(SHIPPED).filter((f) => f.endsWith(".md"));

  test.each(
    AGENT_PLATFORMS.map((platform) => [platform])
  )("every one renders for %s", (platform) => {
    for (const file of sources) {
      expect(() =>
        renderAgentForPlatform(readFileSync(resolve(SHIPPED, file), "utf-8"), platform)
      ).not.toThrow();
    }
  });

  test("codex gets a .toml file and the rest get .md", () => {
    expect(agentFileName("researcher", "codex")).toBe("researcher.toml");
    expect(agentFileName("researcher", "cursor")).toBe("researcher.md");
  });
});

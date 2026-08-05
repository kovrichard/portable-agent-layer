import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadCopilotHooksTemplate } from "../src/targets/lib";

const TEMPLATE = resolve(import.meta.dir, "../assets/templates/hooks.copilot.json");
const PKG_ROOT = "C:/pkg";

type Entry = { type?: string; bash?: string; powershell?: string; command?: string };

function entries(): Array<{ event: string; entry: Entry }> {
  const cfg = loadCopilotHooksTemplate(TEMPLATE, PKG_ROOT) as {
    hooks: Record<string, Entry[]>;
  };
  return Object.entries(cfg.hooks).flatMap(([event, list]) =>
    list.map((entry) => ({ event, entry }))
  );
}

describe("Copilot hooks template", () => {
  test("declares the documented schema version", () => {
    const cfg = loadCopilotHooksTemplate(TEMPLATE, PKG_ROOT) as { version: number };
    expect(cfg.version).toBe(1);
  });

  test("registers hooks for every event PAL relies on", () => {
    const cfg = loadCopilotHooksTemplate(TEMPLATE, PKG_ROOT) as {
      hooks: Record<string, Entry[]>;
    };
    expect(Object.keys(cfg.hooks).sort()).toEqual([
      "agentStop",
      "preToolUse",
      "sessionStart",
      "userPromptSubmitted",
    ]);
  });

  // Regression: a bash-only template ran under WSL bash on Windows, where the
  // Windows bun binary does not exist — every hook died with exit 127.
  test("every entry carries a powershell command so Windows can run it", () => {
    for (const { event, entry } of entries()) {
      expect(`${event}:${entry.powershell ?? "MISSING"}`).toContain("bun run");
    }
  });

  test("every entry keeps a bash command for macOS, Linux and cloud agents", () => {
    for (const { event, entry } of entries()) {
      expect(`${event}:${entry.bash ?? "MISSING"}`).toContain("bun run");
    }
  });

  test("both shells set PAL_AGENT=copilot in their own syntax", () => {
    for (const { event, entry } of entries()) {
      expect(`${event}:${entry.bash}`).toContain("PAL_AGENT=copilot bun run");
      expect(`${event}:${entry.powershell}`).toContain(
        "$env:PAL_AGENT='copilot'; bun run"
      );
    }
  });

  test("both shells point at the same hook script", () => {
    const script = (cmd: string) => cmd.slice(cmd.lastIndexOf("/") + 1);
    for (const { entry } of entries()) {
      expect(script(entry.powershell ?? "")).toBe(script(entry.bash ?? ""));
    }
  });

  test("PKG_ROOT is substituted, leaving no unresolved placeholder", () => {
    expect(readFileSync(TEMPLATE, "utf-8")).toContain("{{PKG_ROOT}}");
    for (const { entry } of entries()) {
      expect(entry.bash).toContain(`${PKG_ROOT}/src/hooks/`);
      expect(entry.powershell).toContain(`${PKG_ROOT}/src/hooks/`);
    }
  });
});

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { loadCopilotHooksTemplate } from "../src/targets/lib";

const TEMPLATE = resolve(import.meta.dir, "../assets/templates/hooks.vscode.json");
const COPILOT_TEMPLATE = resolve(
  import.meta.dir,
  "../assets/templates/hooks.copilot.json"
);
const PKG_ROOT = "C:/pkg";

type Entry = { type?: string; bash?: string; powershell?: string; command?: string };

function entries(templatePath = TEMPLATE): Array<{ event: string; entry: Entry }> {
  const cfg = loadCopilotHooksTemplate(templatePath, PKG_ROOT) as {
    hooks: Record<string, Entry[]>;
  };
  return Object.entries(cfg.hooks).flatMap(([event, list]) =>
    list.map((entry) => ({ event, entry }))
  );
}

// VS Code ships its own Copilot build. It reads ~/.copilot/hooks/ like the CLI does but
// knows only Claude's PascalCase event names, so a template using the CLI's lowerCamelCase
// spelling is silently inert there — no error, no hook, no block.
describe("hooks.vscode.json — event vocabulary", () => {
  const VSCODE_EVENTS = new Set([
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PreCompact",
    "SubagentStart",
    "SubagentStop",
    "Stop",
  ]);

  test("every event name is one VS Code recognizes", () => {
    for (const { event } of entries()) {
      expect(VSCODE_EVENTS.has(event)).toBe(true);
    }
  });

  test("uses Stop, never the Copilot CLI's agentStop", () => {
    const events = entries().map((e) => e.event);
    expect(events).toContain("Stop");
    expect(events).not.toContain("agentStop");
  });

  test("shares no event name with the Copilot CLI template, so neither file runs twice", () => {
    const vscodeEvents = new Set(entries().map((e) => e.event));
    const cliEvents = new Set(entries(COPILOT_TEMPLATE).map((e) => e.event));
    const overlap = [...vscodeEvents].filter((e) => cliEvents.has(e));
    expect(overlap).toEqual([]);
  });
});

describe("hooks.vscode.json — shell-agnostic commands", () => {
  // Regression: the Copilot template shipped only a `bash` command, and on Windows
  // `bash` resolves to WSL2, where the Windows `bun` does not exist — every hook
  // died with exit 127 before running. An argv flag needs no shell agreement at all.
  test("declares its agent by argv flag, not a shell-specific env prefix", () => {
    for (const { entry } of entries()) {
      expect(entry.command).toContain("--agent=vscode");
      expect(entry.command).not.toContain("PAL_AGENT=");
      expect(entry.command).not.toContain("$env:PAL_AGENT");
    }
  });

  test("uses the cross-platform command field only", () => {
    for (const { entry } of entries()) {
      expect(entry.type).toBe("command");
      expect(typeof entry.command).toBe("string");
      expect(entry.bash).toBeUndefined();
      expect(entry.powershell).toBeUndefined();
    }
  });

  test("resolves {{PKG_ROOT}} into every command", () => {
    for (const { entry } of entries()) {
      expect(entry.command).toContain(PKG_ROOT);
      expect(entry.command).not.toContain("{{PKG_ROOT}}");
    }
  });
});

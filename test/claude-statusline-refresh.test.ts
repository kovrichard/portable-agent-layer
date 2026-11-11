import { describe, expect, test } from "bun:test";
import { addStatuslineConfig } from "../src/targets/lib";

const palClaudeCommand =
  process.platform === "win32"
    ? "powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/statusline.ps1"
    : "~/.claude/statusline.sh";

type StatusLine = { statusLine: Record<string, unknown> };

describe("claude statusline refresh interval", () => {
  test("a fresh install refreshes PAL's statusline every 20 seconds", () => {
    const updated = addStatuslineConfig({}, "claude") as StatusLine;
    expect(updated.statusLine).toEqual({
      type: "command",
      command: palClaudeCommand,
      padding: 2,
      refreshInterval: 20,
    });
  });

  test("an existing PAL statusline without an interval gets one", () => {
    const config = {
      statusLine: { type: "command", command: palClaudeCommand, padding: 2 },
    };
    const updated = addStatuslineConfig(config, "claude") as StatusLine;
    expect(updated.statusLine).toEqual({
      type: "command",
      command: palClaudeCommand,
      padding: 2,
      refreshInterval: 20,
    });
  });

  test("an interval the user set on PAL's statusline is kept", () => {
    const config = {
      statusLine: { type: "command", command: palClaudeCommand, refreshInterval: 5 },
    };
    const updated = addStatuslineConfig(config, "claude") as StatusLine;
    expect(updated.statusLine.refreshInterval).toBe(5);
  });

  test("a user's own statusline gets no interval", () => {
    const config = { statusLine: { type: "command", command: "~/my-statusline.sh" } };
    const updated = addStatuslineConfig(config, "claude") as StatusLine;
    expect(updated.statusLine).toEqual({
      type: "command",
      command: "~/my-statusline.sh",
    });
  });

  test("the other agents' statuslines get no claude interval", () => {
    const cursor = addStatuslineConfig({}, "cursor") as StatusLine;
    const antigravity = addStatuslineConfig({}, "antigravity") as StatusLine;
    expect(cursor.statusLine.refreshInterval).toBeUndefined();
    expect(antigravity.statusLine.refreshInterval).toBeUndefined();
  });
});

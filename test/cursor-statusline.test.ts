import { describe, expect, test } from "bun:test";
import { addStatuslineConfig, removeStatuslineConfig } from "../src/targets/lib";

describe("cursor statusline config", () => {
  test("addStatuslineConfig sets PAL defaults when absent", () => {
    const updated = addStatuslineConfig({}, "cursor");
    expect(updated.statusLine).toEqual({
      type: "command",
      command: "~/.cursor/statusline.sh",
      padding: 2,
      updateIntervalMs: 300,
      timeoutMs: 2000,
    });
  });

  test("addStatuslineConfig preserves user command", () => {
    const config = {
      statusLine: {
        type: "command",
        command: "jq -r '.model.display_name'",
      },
    };
    expect(addStatuslineConfig(config, "cursor")).toBe(config);
  });

  test("addStatuslineConfig refreshes PAL command", () => {
    const config = {
      statusLine: {
        type: "command",
        command: "~/.cursor/statusline.sh",
        padding: 0,
      },
    };
    const updated = addStatuslineConfig(config, "cursor");
    expect(updated.statusLine).toEqual({
      type: "command",
      command: "~/.cursor/statusline.sh",
      padding: 2,
      updateIntervalMs: 300,
      timeoutMs: 2000,
    });
  });

  test("removeStatuslineConfig removes only PAL command", () => {
    const pal = {
      statusLine: { type: "command", command: "~/.cursor/statusline.sh" },
    };
    expect(removeStatuslineConfig(pal, "cursor").statusLine).toBeUndefined();

    const custom = {
      statusLine: { type: "command", command: "jq -r '.model.display_name'" },
    };
    expect(removeStatuslineConfig(custom, "cursor")).toBe(custom);
  });

  test("removeStatuslineConfig on claude removes unconditionally", () => {
    const config = {
      statusLine: { type: "command", command: "jq -r '.model.display_name'" },
    };
    expect(removeStatuslineConfig(config, "claude").statusLine).toBeUndefined();
  });
});

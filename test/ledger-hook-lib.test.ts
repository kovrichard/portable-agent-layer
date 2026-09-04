import { describe, expect, test } from "bun:test";
import { ledgeredCall, ledgeredTarget, toolUseIdOf } from "../src/hooks/lib/ledger-hook";

// Both hooks ask these two questions of every payload, and they must answer
// identically: a snapshot taken for a call the commit half ignores is a
// snapshot nothing ever claims.

describe("toolUseIdOf", () => {
  test("reads the id Claude Code sends", () => {
    expect(toolUseIdOf({ tool_use_id: "toolu_01ABC" })).toBe("toolu_01ABC");
  });

  test("accepts the camelCase and tool_call_id spellings other agents use", () => {
    expect(toolUseIdOf({ toolUseId: "id-1" })).toBe("id-1");
    expect(toolUseIdOf({ tool_call_id: "id-2" })).toBe("id-2");
  });

  test("returns null when no id is present, so the pair is never guessed at", () => {
    expect(toolUseIdOf({ tool_name: "Edit" })).toBeNull();
  });

  test("rejects an empty or non-string id rather than keying a file on it", () => {
    expect(toolUseIdOf({ tool_use_id: "" })).toBeNull();
    expect(toolUseIdOf({ tool_use_id: 42 })).toBeNull();
    expect(toolUseIdOf({ tool_use_id: null })).toBeNull();
  });
});

describe("ledgeredTarget", () => {
  test("returns the path for the tools that carry their own target", () => {
    expect(ledgeredTarget("Edit", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(ledgeredTarget("Write", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
  });

  test("matches the tool name whatever its casing", () => {
    expect(ledgeredTarget("edit", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(ledgeredTarget("WRITE", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
  });

  test("accepts the other spellings of the path argument", () => {
    expect(ledgeredTarget("Edit", { filePath: "/a/b.ts" })).toBe("/a/b.ts");
    expect(ledgeredTarget("Edit", { path: "/a/b.ts" })).toBe("/a/b.ts");
  });

  test("declines a read, which is a query rather than an action", () => {
    expect(ledgeredTarget("Read", { file_path: "/a/b.ts" })).toBeNull();
    expect(ledgeredTarget("Glob", { file_path: "/a/b.ts" })).toBeNull();
  });

  // Its effect is not derivable from its arguments, so a path in the payload
  // would not mean the shell command changed that path.
  test("declines Bash even when a path is present", () => {
    expect(ledgeredTarget("Bash", { file_path: "/a/b.ts" })).toBeNull();
  });

  test("declines a ledgered tool with no usable path", () => {
    expect(ledgeredTarget("Edit", {})).toBeNull();
    expect(ledgeredTarget("Edit", { file_path: "" })).toBeNull();
    expect(ledgeredTarget("Edit", { file_path: 7 })).toBeNull();
  });
});

// Each half of the pair runs this once and acts on its answer. What matters is
// that one payload cannot be a call to one half and not to the other.
describe("ledgeredCall", () => {
  const PAYLOAD = {
    tool_use_id: "toolu_01ABC",
    tool_name: "Edit",
    tool_input: { file_path: "/a/b.ts" },
  };

  test("reads a real edit payload into the three things both halves need", () => {
    expect(ledgeredCall(PAYLOAD)).toEqual({
      toolUseId: "toolu_01ABC",
      tool: "Edit",
      target: "/a/b.ts",
    });
  });

  test("declines a payload missing the id that would pair the two halves", () => {
    expect(
      ledgeredCall({ tool_name: "Edit", tool_input: { file_path: "/a/b.ts" } })
    ).toBeNull();
  });

  test("declines a payload with no tool name", () => {
    expect(ledgeredCall({ tool_use_id: "toolu_01ABC" })).toBeNull();
  });

  test("declines a tool the ledger does not record", () => {
    expect(ledgeredCall({ ...PAYLOAD, tool_name: "Read" })).toBeNull();
    expect(ledgeredCall({ ...PAYLOAD, tool_name: "Bash" })).toBeNull();
  });

  test("declines an edit whose payload carries no path", () => {
    expect(ledgeredCall({ ...PAYLOAD, tool_input: {} })).toBeNull();
  });

  test("reads the camelCase payload shape other agents send", () => {
    expect(
      ledgeredCall({
        toolUseId: "id-1",
        toolName: "Write",
        toolArgs: { filePath: "/x.ts" },
      })
    ).toEqual({
      toolUseId: "id-1",
      tool: "Write",
      target: "/x.ts",
    });
  });
});

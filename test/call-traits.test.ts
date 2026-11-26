import { describe, expect, test } from "bun:test";
import { callTraits, sizeOf, stringIn } from "../src/usage/call-traits";

const traits = (toolName: string, toolInput: Record<string, unknown>) =>
  callTraits({ toolName, toolInput });

describe("callTraits", () => {
  test("reads the program from every agent's name for the command", () => {
    expect(traits("Bash", { command: "/usr/bin/git push" }).program).toBe("git");
    expect(traits("shell", { commandLine: "npm test" }).program).toBe("npm");
    expect(traits("shell", { CommandLine: "dir /b" }).program).toBe("dir");
    expect(traits("shell", { script: "ls -la" }).program).toBe("ls");
    expect(traits("Bash", {}).program).toBeNull();
  });

  test("reads the host of a url, and nothing from a url that does not parse", () => {
    expect(traits("WebFetch", { url: "https://example.com/a" }).host).toBe("example.com");
    expect(traits("WebFetch", { url: "not a url" }).host).toBeNull();
    expect(traits("WebFetch", {}).host).toBeNull();
  });

  test("names the MCP server only for an MCP tool", () => {
    expect(traits("mcp__github__create_issue", {}).mcpServer).toBe("github");
    expect(traits("Bash", {}).mcpServer).toBeNull();
  });

  test("keeps the file's extension, the skill and the subagent", () => {
    expect(
      traits("Edit", { file_path: "/x/a.test.ts", skill: "ship", subagent_type: "scout" })
    ).toMatchObject({ fileExt: ".ts", skill: "ship", subagent: "scout" });
    expect(traits("Edit", { file_path: "/x/Makefile" }).fileExt).toBeNull();
  });

  test("measures the input's size", () => {
    expect(traits("Bash", { command: "ls" }).inputChars).toBe(16);
  });
});

describe("stringIn", () => {
  test("takes the first non-empty string, skipping empty strings and other types", () => {
    expect(stringIn({ a: "", b: 3, c: "yes" }, ["a", "b", "c"])).toBe("yes");
    expect(stringIn({ a: "", b: 3 }, ["a", "b"])).toBeNull();
  });
});

describe("sizeOf", () => {
  test("nothing has no size, a string its length, anything else its JSON length", () => {
    expect(sizeOf(undefined)).toBe(0);
    expect(sizeOf(null)).toBe(0);
    expect(sizeOf("abc")).toBe(3);
    expect(sizeOf({ a: 1 })).toBe(7);
  });
});

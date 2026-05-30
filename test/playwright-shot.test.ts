import { describe, expect, test } from "bun:test";
import { chooseTier, parseArgs } from "../assets/skills/playwright/tools/shot-lib";

describe("parseArgs", () => {
  test("parses url, viewport, flags and output", () => {
    const o = parseArgs([
      "https://x.test",
      "--viewport",
      "1440x900",
      "--full-page",
      "--selector",
      "#main",
      "-o",
      "/tmp/a.png",
    ]);
    expect(o.url).toBe("https://x.test");
    expect(o.viewport).toEqual({ width: 1440, height: 900 });
    expect(o.fullPage).toBe(true);
    expect(o.selector).toBe("#main");
    expect(o.out).toBe("/tmp/a.png");
  });

  test("accepts WxH with a comma too", () => {
    expect(parseArgs(["u", "--viewport", "390,844"]).viewport).toEqual({
      width: 390,
      height: 844,
    });
  });

  test("requires a url", () => {
    expect(() => parseArgs(["--full-page"])).toThrow(/URL is required/);
  });

  test("rejects a malformed viewport", () => {
    expect(() => parseArgs(["u", "--viewport", "nope"])).toThrow(/viewport/);
  });
});

describe("chooseTier", () => {
  test("no cli available → node", () => {
    expect(chooseTier({ cliAvailable: false })).toBe("node");
  });

  test("cli available, plain capture → cli", () => {
    expect(chooseTier({ cliAvailable: true })).toBe("cli");
  });

  // The non-obvious branch: playwright-cli can't set a viewport, so a sized
  // request must fall through to the Node engine even when the CLI exists.
  test("cli available but viewport requested → node", () => {
    expect(chooseTier({ cliAvailable: true, viewport: { width: 1, height: 1 } })).toBe(
      "node"
    );
  });

  test("cli available but full-page requested → node", () => {
    expect(chooseTier({ cliAvailable: true, fullPage: true })).toBe("node");
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { palEnvPath, parsePalEnv, withPalEnv } from "../src/hooks/lib/pal-env";
import { freshTestDir } from "./lib/test-home";

describe("parsePalEnv", () => {
  test("reads one KEY=value per line, skipping blanks and comments", () => {
    expect(parsePalEnv("# token\n\nA=1\r\n  B=2  \n")).toEqual({ A: "1", B: "2" });
  });

  test("accepts lines copied from a shell profile", () => {
    expect(parsePalEnv("export A=1\nexport   B=2")).toEqual({ A: "1", B: "2" });
  });

  test("strips surrounding quotes", () => {
    expect(parsePalEnv(`A="one two"\nB='x'`)).toEqual({ A: "one two", B: "x" });
  });

  test("splits on the first = so padded values survive", () => {
    expect(parsePalEnv("TOKEN=abc==")).toEqual({ TOKEN: "abc==" });
  });

  test("ignores lines without a key", () => {
    expect(parsePalEnv("=orphan\nno-equals-sign")).toEqual({});
  });
});

describe("withPalEnv", () => {
  let home: string;

  beforeEach(() => {
    home = freshTestDir(import.meta.file);
    process.env.PAL_HOME = home;
  });

  test("lives at the root of PAL's home", () => {
    expect(palEnvPath()).toBe(resolve(home, ".env"));
  });

  test("fills variables the environment lacks", () => {
    writeFileSync(palEnvPath(), "CLAUDE_CODE_OAUTH_TOKEN=from-file\n");
    expect(withPalEnv({}).CLAUDE_CODE_OAUTH_TOKEN).toBe("from-file");
  });

  test("a variable already set in the environment wins", () => {
    writeFileSync(palEnvPath(), "CLAUDE_CODE_OAUTH_TOKEN=from-file\n");
    const env = withPalEnv({ CLAUDE_CODE_OAUTH_TOKEN: "from-shell" });
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("from-shell");
  });

  test("an empty environment value is filled from the file", () => {
    writeFileSync(palEnvPath(), "PAL_ANTHROPIC_API_KEY=from-file\n");
    expect(withPalEnv({ PAL_ANTHROPIC_API_KEY: "" }).PAL_ANTHROPIC_API_KEY).toBe(
      "from-file"
    );
  });

  test("without the file the environment passes through untouched", () => {
    expect(withPalEnv({ A: "1" })).toEqual({ A: "1" });
  });
});

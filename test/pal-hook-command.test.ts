import { describe, expect, test } from "bun:test";
import { canonicalPalCmd, isOutdatedPalHook } from "../src/targets/pal-hook-command";

const WINDOWS = "bun run C:\\Users\\me\\pkg\\src\\hooks\\LoadContext.ts";
const POSIX = "bun run /home/me/pkg/src/hooks/LoadContext.ts";

describe("a PAL hook command", () => {
  test.each([
    ["forward slashes", POSIX],
    ["backslashes", WINDOWS],
    ["a leading env assignment", `PAL_AGENT=claude ${WINDOWS}`],
  ])("written with %s reads as the same hook", (_, cmd) => {
    expect(canonicalPalCmd(cmd)).toBe("bun run src/hooks/LoadContext.ts");
  });

  test("a shipped hook is recognised as PAL's own, whichever slash it was written with", () => {
    const shipped = new Set(["bun run src/hooks/LoadContext.ts"]);

    expect(isOutdatedPalHook(WINDOWS, shipped)).toBe(true);
    expect(canonicalPalCmd(WINDOWS)).toBe(canonicalPalCmd(POSIX));
  });

  test("a command that is not a PAL hook stays as written", () => {
    expect(canonicalPalCmd("echo hi")).toBe("echo hi");
  });
});

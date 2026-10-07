import { describe, expect, test } from "bun:test";
import { allowPalHome, removePalHomeAllow } from "../src/targets/opencode/permission";

const PAL = "/home/u/.pal/**";

describe("opencode external_directory allow for PAL home", () => {
  test("adds the rule to a config without permissions", () => {
    expect(allowPalHome({ theme: "x" }, PAL)).toEqual({
      theme: "x",
      permission: { external_directory: { [PAL]: "allow" } },
    });
  });

  test("a flat action becomes the catch-all, so PAL's rule still wins for PAL home", () => {
    const config = { permission: { external_directory: "deny", bash: "ask" } };
    expect(allowPalHome(config, PAL).permission).toEqual({
      external_directory: { "*": "deny", [PAL]: "allow" },
      bash: "ask",
    });
  });

  test("the rule is kept last, since opencode applies the last match", () => {
    const config = {
      permission: { external_directory: { [PAL]: "allow", "*": "deny" } },
    };
    const rules = allowPalHome(config, PAL).permission as Record<string, unknown>;
    expect(Object.keys(rules.external_directory as object)).toEqual(["*", PAL]);
  });

  test("removing it keeps the user's rules and drops what becomes empty", () => {
    const user = { "~/secrets/**": "deny" };
    const installed = allowPalHome({ permission: { external_directory: user } }, PAL);
    expect(removePalHomeAllow(installed, PAL)).toEqual({
      permission: { external_directory: user },
    });
    expect(removePalHomeAllow(allowPalHome({ theme: "x" }, PAL), PAL)).toEqual({
      theme: "x",
    });
  });
});
